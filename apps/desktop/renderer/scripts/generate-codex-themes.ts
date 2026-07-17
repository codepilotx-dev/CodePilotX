import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type ThemeVariant = 'light' | 'dark' | 'unknown'

type InventoryTheme = {
  slug: string
  name: string
  displayName?: string
  type?: string
  normalizedHash: string
  colorCount: number
  tokenColorCount: number
  recoverability: 'structured' | 'signature'
  physicalFiles: string[]
}

type Inventory = {
  highlightThemes?: {
    physicalFiles?: string[]
    logicalThemes?: InventoryTheme[]
  }
}

type ThemeRegistration = Record<string, unknown> & {
  name?: string
  displayName?: string
  type?: string
  colors?: Record<string, string>
  tokenColors?: unknown[]
  settings?: unknown[]
}

const DEFAULT_ASSETS_ROOT =
  'E:\\迅雷下载\\Codex\\app_asar_extracted\\webview\\assets'
const DEFAULT_INVENTORY = resolve(
  import.meta.dir,
  '../../../../docs/research/codex-webview-style-inventory.json',
)
const OUTPUT_ROOT = resolve(import.meta.dir, '../shared/codexThemes')
const THEMES_ROOT = resolve(OUTPUT_ROOT, 'themes')
const EXPECTED_LOGICAL_THEMES = 91
const EXPECTED_PHYSICAL_THEMES = 151

const args = parseArgs(process.argv.slice(2))
const assetsRoot = resolve(args['assets-root'] ?? DEFAULT_ASSETS_ROOT)
const inventoryPath = resolve(args.inventory ?? DEFAULT_INVENTORY)
const checkOnly = args.check === true

const inventory = JSON.parse(await readUtf8(inventoryPath)) as Inventory
const logicalThemes = inventory.highlightThemes?.logicalThemes
const physicalFiles = inventory.highlightThemes?.physicalFiles

if (!logicalThemes || !physicalFiles) {
  throw new Error('The inventory does not contain highlight theme evidence.')
}
if (logicalThemes.length !== EXPECTED_LOGICAL_THEMES) {
  throw new Error(
    `Expected ${EXPECTED_LOGICAL_THEMES} logical themes, found ${logicalThemes.length}.`,
  )
}
if (physicalFiles.length !== EXPECTED_PHYSICAL_THEMES) {
  throw new Error(
    `Expected ${EXPECTED_PHYSICAL_THEMES} physical themes, found ${physicalFiles.length}.`,
  )
}

const sortedThemes = [...logicalThemes].sort((left, right) =>
  left.slug.localeCompare(right.slug, 'en'),
)
const slugs = sortedThemes.map(theme => theme.slug)
if (new Set(slugs).size !== slugs.length) {
  throw new Error('The logical theme inventory contains duplicate slugs.')
}
for (const required of ['codex-light', 'codex-dark']) {
  if (!slugs.includes(required)) {
    throw new Error(`Required theme "${required}" is missing.`)
  }
}

const expectedFiles = new Map<string, string>()
const metadata: Array<{
  slug: string
  label: string
  variant: ThemeVariant
  normalizedHash: string
  contentHash: string
  recoverability: 'structured' | 'signature'
  physicalFiles: Array<{ path: string; sha256: string }>
}> = []

for (const inventoryTheme of sortedThemes) {
  const sourceFiles = [...inventoryTheme.physicalFiles].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )
  const primaryPath = resolve(assetsRoot, sourceFiles[0]!)
  const sourceHashes: Array<{ path: string; sha256: string }> = []
  for (const path of sourceFiles) {
    const bytes = await readFile(resolve(assetsRoot, path))
    decodeUtf8(bytes, path)
    sourceHashes.push({ path, sha256: sha256(bytes) })
  }

  const imported = (await import(
    `${pathToFileURL(primaryPath).href}?codex-theme-generator=${sourceHashes[0]!.sha256}`
  )) as { default?: ThemeRegistration }
  if (!imported.default || typeof imported.default !== 'object') {
    throw new Error(`${sourceFiles[0]} does not export a theme object.`)
  }

  const original = JSON.parse(JSON.stringify(imported.default)) as ThemeRegistration
  const theme = normalizeTheme(
    original,
    inventoryTheme.slug,
    inventoryTheme.type,
  )
  const variant = normalizeVariant(inventoryTheme.type)
  const label =
    normalizeLabel(original.displayName) ??
    normalizeLabel(original.name) ??
    normalizeLabel(inventoryTheme.displayName) ??
    normalizeLabel(inventoryTheme.name) ??
    inventoryTheme.slug
  const contentHash = sha256(canonicalJson(theme))
  const relativePath = `themes/${inventoryTheme.slug}.ts`

  expectedFiles.set(
    relativePath,
    renderThemeModule(theme, inventoryTheme.slug, sourceHashes),
  )
  metadata.push({
    slug: inventoryTheme.slug,
    label,
    variant,
    normalizedHash: inventoryTheme.normalizedHash,
    contentHash,
    recoverability: inventoryTheme.recoverability,
    physicalFiles: sourceHashes,
  })
}

expectedFiles.set('manifest.ts', renderManifest(metadata))
await synchronizeGeneratedFiles(expectedFiles, checkOnly)

console.log(
  checkOnly
    ? `Codex theme catalog is current: ${metadata.length} logical / ${physicalFiles.length} physical.`
    : `Generated ${metadata.length} Codex themes from ${physicalFiles.length} physical modules.`,
)

function normalizeTheme(
  original: ThemeRegistration,
  slug: string,
  inventoryType?: string,
): ThemeRegistration {
  const theme = { ...original }
  if (!Array.isArray(theme.tokenColors) && Array.isArray(theme.settings)) {
    theme.tokenColors = theme.settings
  }
  delete theme.settings
  delete theme.displayName
  theme.name = slug

  if (!theme.colors || typeof theme.colors !== 'object') {
    throw new Error(`${slug} does not contain a colors object.`)
  }
  if (!Array.isArray(theme.tokenColors)) {
    throw new Error(`${slug} does not contain tokenColors/settings.`)
  }
  const variant =
    normalizeVariant(theme.type) !== 'unknown'
      ? normalizeVariant(theme.type)
      : normalizeVariant(inventoryType) !== 'unknown'
        ? normalizeVariant(inventoryType)
        : slug.endsWith('-light')
          ? 'light'
          : slug.endsWith('-dark')
            ? 'dark'
            : 'unknown'
  if (variant === 'unknown') {
    throw new Error(`${slug} does not declare a light/dark type.`)
  }
  theme.type = variant
  return sortObject(theme) as ThemeRegistration
}

function renderThemeModule(
  theme: ThemeRegistration,
  slug: string,
  physicalFiles: Array<{ path: string; sha256: string }>,
): string {
  const sources = physicalFiles.map(source => source.path).join(', ')
  return `// Generated by scripts/generate-codex-themes.ts from ${sources}.
// Do not edit this file manually.
import type { ThemeRegistration } from 'shiki'

const theme = ${JSON.stringify(theme, null, 2)} as unknown as ThemeRegistration

export default theme
export const codexThemeSlug = ${JSON.stringify(slug)}
`
}

function renderManifest(
  themes: ReadonlyArray<(typeof metadata)[number]>,
): string {
  const defaultImports = `import codexDark from './themes/codex-dark.js'
import codexLight from './themes/codex-light.js'`
  const rows = themes
    .map(
      theme => `  {
    slug: ${JSON.stringify(theme.slug)},
    label: ${JSON.stringify(theme.label)},
    variant: ${JSON.stringify(theme.variant)},
    normalizedHash: ${JSON.stringify(theme.normalizedHash)},
    contentHash: ${JSON.stringify(theme.contentHash)},
    recoverability: ${JSON.stringify(theme.recoverability)},
    physicalFiles: ${JSON.stringify(theme.physicalFiles)},
  },`,
    )
    .join('\n')
  const loaders = themes
    .map(theme => {
      const expression =
        theme.slug === 'codex-dark'
          ? 'Promise.resolve(codexDark)'
          : theme.slug === 'codex-light'
            ? 'Promise.resolve(codexLight)'
            : `import('./themes/${theme.slug}.js').then(module => module.default)`
      return `  ${JSON.stringify(theme.slug)}: () => ${expression},`
    })
    .join('\n')

  return `// Generated by scripts/generate-codex-themes.ts.
// Do not edit this file manually.
import type { ThemeRegistration } from 'shiki'
${defaultImports}

export const CODEX_HIGHLIGHT_THEMES = [
${rows}
] as const

export type CodexHighlightThemeSlug =
  (typeof CODEX_HIGHLIGHT_THEMES)[number]['slug']
export type CodexHighlightThemeVariant =
  (typeof CODEX_HIGHLIGHT_THEMES)[number]['variant']

const CODEX_HIGHLIGHT_THEME_SLUGS = new Set<string>(
  CODEX_HIGHLIGHT_THEMES.map(theme => theme.slug),
)

const CODEX_HIGHLIGHT_THEME_LOADERS: Record<
  CodexHighlightThemeSlug,
  () => Promise<ThemeRegistration>
> = {
${loaders}
}

export function isCodexHighlightThemeSlug(
  value: unknown,
): value is CodexHighlightThemeSlug {
  return (
    typeof value === 'string' &&
    CODEX_HIGHLIGHT_THEME_SLUGS.has(value)
  )
}

export function loadCodexHighlightTheme(
  slug: CodexHighlightThemeSlug,
): Promise<ThemeRegistration> {
  return CODEX_HIGHLIGHT_THEME_LOADERS[slug]()
}
`
}

async function synchronizeGeneratedFiles(
  expected: Map<string, string>,
  check: boolean,
): Promise<void> {
  const currentPaths = await listGeneratedFiles()
  const expectedPaths = [...expected.keys()].sort()
  const stale = new Set<string>()

  for (const path of expectedPaths) {
    const current = await readUtf8(resolve(OUTPUT_ROOT, path)).catch(() => '')
    if (current !== expected.get(path)) stale.add(path)
  }
  for (const path of currentPaths) {
    if (!expected.has(path)) stale.add(path)
  }

  if (check && stale.size > 0) {
    throw new Error(
      `Codex theme catalog is out of date: ${[...stale].sort().join(', ')}`,
    )
  }
  if (check || stale.size === 0) return

  await rm(OUTPUT_ROOT, { recursive: true, force: true })
  await mkdir(THEMES_ROOT, { recursive: true })
  for (const [path, contents] of expected) {
    const destination = resolve(OUTPUT_ROOT, path)
    await mkdir(resolve(destination, '..'), { recursive: true })
    await writeFile(destination, contents, 'utf8')
  }
}

async function listGeneratedFiles(): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string, prefix = ''): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    )
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await visit(resolve(directory, entry.name), relative)
      } else {
        files.push(relative)
      }
    }
  }
  await visit(OUTPUT_ROOT)
  return files.sort()
}

function parseArgs(values: string[]): Record<string, string | true> {
  const result: Record<string, string | true> = {}
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index]!
    if (argument === '--check') {
      result.check = true
      continue
    }
    if (argument === '--assets-root' || argument === '--inventory') {
      const value = values[index + 1]
      if (!value) throw new Error(`${argument} requires a value.`)
      result[argument.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return result
}

async function readUtf8(path: string): Promise<string> {
  const bytes = await readFile(path)
  return decodeUtf8(bytes, path)
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`Invalid UTF-8: ${basename(path)}`)
  }
}

function normalizeVariant(value: unknown): ThemeVariant {
  return value === 'light' || value === 'dark' ? value : 'unknown'
}

function normalizeLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, child]) => [key, sortObject(child)]),
    )
  }
  return value
}
