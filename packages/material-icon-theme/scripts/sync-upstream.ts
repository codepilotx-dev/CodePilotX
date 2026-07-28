import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

const upstreamVersion = "5.37.0"
const upstreamUrl =
  "https://registry.npmjs.org/material-icon-theme/-/material-icon-theme-5.37.0.tgz"
const upstreamSha512 =
  "fc5e6594e554d0367cf15fb098f9446c1aa2f05a1c84f8395da27bcea5731824d3ca07859e92297554104d11251271f2c5259131f174c016ceab014a9ee8c52c"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const iconsDirectory = join(packageRoot, "src", "icons")
const generatedDirectory = join(packageRoot, "src", "generated")
const check = process.argv.includes("--check")
const iconShardCount = 16

interface UpstreamManifest {
  iconDefinitions: Record<string, { iconPath: string }>
  fileNames: Record<string, string>
  fileExtensions: Record<string, string>
  languageIds: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  rootFolderNames: Record<string, string>
  rootFolderNamesExpanded: Record<string, string>
  file: string
  folder: string
  folderExpanded: string
  rootFolder: string
  rootFolderExpanded: string
}

interface GeneratedFile {
  path: string
  content: string
}

const temporaryRoots: string[] = []

try {
  const upstreamRoot = await resolveUpstreamRoot()
  const manifest = JSON.parse(
    await readFile(join(upstreamRoot, "dist", "material-icons.json"), "utf8"),
  ) as UpstreamManifest
  const generated = await generateFiles(upstreamRoot, manifest)

  if (check) {
    await checkGeneratedFiles(generated)
    console.log(
      `material-icon-theme@${upstreamVersion}: ${Object.keys(manifest.iconDefinitions).length} icon definitions are current`,
    )
  } else {
    await writeGeneratedFiles(generated)
    console.log(
      `material-icon-theme@${upstreamVersion}: generated ${Object.keys(manifest.iconDefinitions).length} monochrome React icons`,
    )
  }
} finally {
  await Promise.all(
    temporaryRoots.map((path) => rm(path, { recursive: true, force: true })),
  )
}

async function resolveUpstreamRoot(): Promise<string> {
  const configured = process.env.MATERIAL_ICON_THEME_ROOT
  const candidates = [
    configured,
    join(packageRoot, "node_modules", "material-icon-theme"),
    join(packageRoot, "..", "..", "node_modules", "material-icon-theme"),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const packageJsonPath = join(candidate, "package.json")
    if (!existsSync(packageJsonPath)) continue
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf8"),
    ) as { version?: string }
    if (packageJson.version !== upstreamVersion) {
      throw new Error(
        `Expected material-icon-theme@${upstreamVersion}, found ${packageJson.version ?? "unknown"} at ${candidate}`,
      )
    }
    return candidate
  }

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "codepilotx-material-icon-theme-"),
  )
  temporaryRoots.push(temporaryRoot)
  const archivePath = join(temporaryRoot, "upstream.tgz")
  const response = await fetch(upstreamUrl)
  if (!response.ok) {
    throw new Error(
      `Unable to download ${upstreamUrl}: ${response.status} ${response.statusText}`,
    )
  }
  const archive = Buffer.from(await response.arrayBuffer())
  const hash = createHash("sha512").update(archive).digest("hex")
  if (hash !== upstreamSha512) {
    throw new Error(`Checksum mismatch for material-icon-theme@${upstreamVersion}`)
  }
  await writeFile(archivePath, archive)
  await extractTar(gunzipSync(archive), temporaryRoot)
  return join(temporaryRoot, "package")
}

async function extractTar(archive: Uint8Array, destination: string): Promise<void> {
  const decoder = new TextDecoder()
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readTarString(decoder, header.subarray(0, 100))
    const prefix = readTarString(decoder, header.subarray(345, 500))
    const path = prefix ? `${prefix}/${name}` : name
    const sizeText = readTarString(decoder, header.subarray(124, 136)).trim()
    const size = Number.parseInt(sizeText || "0", 8)
    if (!Number.isFinite(size) || size < 0) throw new Error("Invalid tar entry")
    const bodyOffset = offset + 512
    const type = header[156]

    if (type === 0 || type === 48) {
      const target = resolve(destination, path.replaceAll("/", sep))
      const safeRoot = `${resolve(destination)}${sep}`
      if (!target.startsWith(safeRoot)) {
        throw new Error(`Unsafe tar entry: ${path}`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, archive.subarray(bodyOffset, bodyOffset + size))
    }
    offset = bodyOffset + Math.ceil(size / 512) * 512
  }
}

function readTarString(decoder: TextDecoder, value: Uint8Array): string {
  const end = value.indexOf(0)
  return decoder.decode(end >= 0 ? value.subarray(0, end) : value)
}

async function generateFiles(
  upstreamRoot: string,
  manifest: UpstreamManifest,
): Promise<GeneratedFile[]> {
  const definitions = Object.entries(manifest.iconDefinitions).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const generated: GeneratedFile[] = []
  const shardDefinitions = Array.from(
    { length: iconShardCount },
    () => [] as Array<{ iconName: string; componentName: string }>,
  )

  for (const [iconName, definition] of definitions) {
    const sourcePath = resolve(
      upstreamRoot,
      "dist",
      definition.iconPath.replaceAll("/", "\\"),
    )
    const rawSvg = await readFile(sourcePath, "utf8")
    const { viewBox, body } = monochromeSvg(rawSvg)
    const componentName = toComponentName(iconName)
    const relativePath = join("src", "icons", `${iconName}.tsx`)
    generated.push({
      path: relativePath,
      content: generatedIconFile(componentName, viewBox, body),
    })
    shardDefinitions[iconShard(iconName)].push({ iconName, componentName })
  }

  generated.push({
    path: join("src", "icons", "index.ts"),
    content: `${generatedHeader()}export { createMaterialIcon } from "./create-icon"
export type { MaterialSvgIconProps } from "./create-icon"
export { iconNames, type IconName } from "./names"
export { iconShard, loadIconShard, type IconComponent, type IconShard } from "./loaders"
`,
  })
  generated.push({
    path: join("src", "icons", "names.ts"),
    content: `${generatedHeader()}export const iconNames = ${JSON.stringify(definitions.map(([name]) => name), null, 2)} as const

export type IconName = (typeof iconNames)[number]
`,
  })
  for (const [shardIndex, shard] of shardDefinitions.entries()) {
    const imports = shard.map(
      ({ iconName, componentName }) =>
        `import ${componentName} from "./${iconName}"`,
    )
    const entries = shard.map(
      ({ iconName, componentName }) =>
        `  ${JSON.stringify(iconName)}: ${componentName},`,
    )
    generated.push({
      path: join("src", "icons", `shard-${shardIndex.toString(16)}.ts`),
      content: `${generatedHeader()}${imports.join("\n")}

export const iconComponents = {
${entries.join("\n")}
} as const
`,
    })
  }
  generated.push({
    path: join("src", "icons", "loaders.ts"),
    content: generatedShardLoaders(),
  })
  generated.push({
    path: join("src", "generated", "manifest.ts"),
    content: generatedManifest(manifest),
  })
  return generated
}

function iconShard(iconName: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < iconName.length; index += 1) {
    hash ^= iconName.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % iconShardCount
}

function generatedShardLoaders(): string {
  const loaders = Array.from(
    { length: iconShardCount },
    (_, index) =>
      `  () => import("./shard-${index.toString(16)}"),`,
  )
  return `${generatedHeader()}import type { ComponentType } from "react"
import type { MaterialSvgIconProps } from "./create-icon"
import type { IconName } from "./names"

export type IconComponent = ComponentType<MaterialSvgIconProps>
export type IconShard = Readonly<Partial<Record<IconName, IconComponent>>>

const shardLoaders = [
${loaders.join("\n")}
] as const

export function iconShard(iconName: IconName): number {
  let hash = 2_166_136_261
  for (let index = 0; index < iconName.length; index += 1) {
    hash ^= iconName.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % shardLoaders.length
}

export async function loadIconShard(iconName: IconName): Promise<IconShard> {
  const module = await shardLoaders[iconShard(iconName)]()
  return module.iconComponents as IconShard
}
`
}

function monochromeSvg(rawSvg: string): { viewBox: string; body: string } {
  const match = rawSvg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>\s*$/i)
  if (!match) throw new Error("Invalid upstream SVG")
  const viewBox =
    match[1].match(/\bviewBox=(["'])(.*?)\1/i)?.[2] ?? "0 0 32 32"
  const body = match[2]
    .replace(
      /\b(fill|stroke|color|stop-color|flood-color|lighting-color)=(["'])(?!none\b|transparent\b)[^"']*\2/gi,
      (_attribute, name: string, quote: string) =>
        `${name}=${quote}currentColor${quote}`,
    )
    .replace(
      /\b(fill|stroke|color|stop-color|flood-color|lighting-color|solid-color|text-decoration-color)\s*:\s*(?!none\b|transparent\b)[^;}"]+/gi,
      "$1:currentColor",
    )
  return { viewBox, body }
}

function generatedIconFile(
  componentName: string,
  viewBox: string,
  body: string,
): string {
  return `${generatedHeader()}import { createMaterialIcon } from "./create-icon"

export const ${componentName} = createMaterialIcon(
  ${JSON.stringify(componentName)},
  ${JSON.stringify(viewBox)},
  ${JSON.stringify(body)},
)

export default ${componentName}
`
}

function generatedManifest(manifest: UpstreamManifest): string {
  const mappings = [
    ["fileNames", manifest.fileNames],
    ["fileExtensions", manifest.fileExtensions],
    ["languageIds", manifest.languageIds],
    ["folderNames", manifest.folderNames],
    ["folderNamesExpanded", manifest.folderNamesExpanded],
    ["rootFolderNames", manifest.rootFolderNames],
    ["rootFolderNamesExpanded", manifest.rootFolderNamesExpanded],
  ] as const
  const declarations = mappings.map(
    ([name, value]) =>
      `export const ${name}: Readonly<Record<string, IconName>> = ${JSON.stringify(normalizeMapping(value), null, 2)}\n`,
  )

  return `${generatedHeader()}import type { IconName } from "../icons"

${declarations.join("\n")}
export const defaultIconNames = ${JSON.stringify(
    {
      file: manifest.file,
      folder: manifest.folder,
      folderExpanded: manifest.folderExpanded,
      rootFolder: manifest.rootFolder,
      rootFolderExpanded: manifest.rootFolderExpanded,
    },
    null,
    2,
  )} as const satisfies Readonly<Record<string, IconName>>
`
}

function normalizeMapping(mapping: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping)
      .map(([key, value]) => [key.replaceAll("\\", "/").toLowerCase(), value])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function toComponentName(iconName: string): string {
  const body = iconName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")
  const safeBody = /^\d/.test(body) ? `Icon${body}` : body
  return `${safeBody}Icon`
}

function generatedHeader(): string {
  return `// Generated from material-icon-theme@${upstreamVersion} by scripts/sync-upstream.ts.
// Do not edit directly.

`
}

async function writeGeneratedFiles(files: GeneratedFile[]): Promise<void> {
  await mkdir(iconsDirectory, { recursive: true })
  await mkdir(generatedDirectory, { recursive: true })
  const existingIcons = await readdir(iconsDirectory)
  await Promise.all(
    existingIcons
      .filter(
        (name) =>
          (name.endsWith(".tsx") || name.endsWith(".ts")) &&
          name !== "create-icon.tsx",
      )
      .map((name) => rm(join(iconsDirectory, name))),
  )
  for (const file of files) {
    const target = join(packageRoot, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content, "utf8")
  }
}

async function checkGeneratedFiles(files: GeneratedFile[]): Promise<void> {
  const failures: string[] = []
  for (const file of files) {
    const target = join(packageRoot, file.path)
    let actual: string
    try {
      actual = await readFile(target, "utf8")
    } catch {
      failures.push(`${file.path} is missing`)
      continue
    }
    if (actual !== file.content) failures.push(`${file.path} is stale`)
  }

  const expectedIconFiles = new Set(
    files
      .filter((file) => dirname(file.path) === join("src", "icons"))
      .map((file) => file.path.split(/[\\/]/).at(-1)),
  )
  for (const name of await readdir(iconsDirectory)) {
    if (
      (name.endsWith(".tsx") || name.endsWith(".ts")) &&
      name !== "create-icon.tsx" &&
      !expectedIconFiles.has(name)
    ) {
      failures.push(`src/icons/${name} is not generated by the pinned upstream`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Generated files are not current:\n- ${failures.join("\n- ")}`)
  }
}
