import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { compile } from 'sass'

type UtilityContract = {
  source: string
  prefix: string
  maxSelectors: number
  maxBytes: number
  maxGzipBytes: number
}

type StyleContractManifest = {
  styleEntrypoint: string
  styleEntrypointImporter: string
  cascadeLayerOrder: string[]
  utilityContract: UtilityContract
  directStyleImportAllowlist: string[]
  lazyStyleEntrypoints: Record<string, 'vendor' | 'features'>
  customPropertyReferenceAllowlist: string[]
  forbiddenCustomPropertyPatterns: string[]
  importantDeclarationAllowlist: Record<string, number>
  dataThemeSelectorAllowlist: Record<string, number>
}

const workspaceRoot = resolve(import.meta.dir, '..')
const sourceRoot = join(workspaceRoot, 'src')
const manifestPath = join(workspaceRoot, 'style-contracts.json')
const styleExtensions = new Set(['.css', '.scss'])
const scriptExtensions = new Set(['.ts', '.tsx'])

function workspacePath(path: string): string {
  return relative(workspaceRoot, path).replaceAll('\\', '/')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path])
    }),
  )
  return files.flat()
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function resolveStyleReference(fromFile: string, reference: string): Promise<string | null> {
  const base = resolve(dirname(fromFile), reference)
  const extension = extname(base)
  const candidates = extension
    ? [base]
    : [
        `${base}.scss`,
        `${base}.css`,
        join(dirname(base), `_${base.split(/[\\/]/).at(-1)}.scss`),
        join(base, 'index.scss'),
        join(base, '_index.scss'),
      ]

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

async function collectEntryGraph(entrypoint: string): Promise<Set<string>> {
  const visited = new Set<string>()

  async function visit(file: string): Promise<void> {
    if (visited.has(file)) return
    visited.add(file)
    const source = await readFile(file, 'utf8')
    const referencePatterns = [
      /@(use|forward)\s+['"]([^'"]+)['"]/g,
      /meta\.load-css\(\s*['"]([^'"]+)['"]/g,
    ]
    for (const pattern of referencePatterns) {
      for (const match of source.matchAll(pattern)) {
        const reference = match[2] ?? match[1]
        const resolved = await resolveStyleReference(file, reference)
        if (resolved) await visit(resolved)
      }
    }
  }

  await visit(entrypoint)
  return visited
}

function collectCustomPropertyDefinitions(source: string, isStyle: boolean): Set<string> {
  const definitions = new Set<string>()
  const patterns = isStyle
    ? [/(--[\w-]+)\s*:/g]
    : [
        /setProperty\(\s*['"](--[\w-]+)['"]/g,
        /['"](--[\w-]+)['"]\s*\??\s*:/g,
        /\[\s*['"](--[\w-]+)['"]\s*\]\s*=/g,
      ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) definitions.add(match[1])
  }
  return definitions
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as StyleContractManifest
const allFiles = await listFiles(sourceRoot)
const styleFiles = allFiles.filter((file) => styleExtensions.has(extname(file)))
const scriptFiles = allFiles.filter((file) => scriptExtensions.has(extname(file)))
const errors: string[] = []

const entrypoint = resolve(workspaceRoot, manifest.styleEntrypoint)
if (!(await isFile(entrypoint)) || !styleExtensions.has(extname(entrypoint))) {
  errors.push(`styleEntrypoint must point to one existing CSS/SCSS file: ${manifest.styleEntrypoint}`)
}

const entrypointSource = await readFile(entrypoint, 'utf8')
const declaredLayerOrder = entrypointSource.match(/@layer\s+([^;]+);/)?.[1]
  .split(',')
  .map((layer) => layer.trim())
if (
  !declaredLayerOrder ||
  declaredLayerOrder.length !== manifest.cascadeLayerOrder.length ||
  declaredLayerOrder.some((layer, index) => layer !== manifest.cascadeLayerOrder[index])
) {
  errors.push(
    `cascade layer order must be: ${manifest.cascadeLayerOrder.join(', ')}`,
  )
}

const loadedLayers = new Set(
  [...entrypointSource.matchAll(/@layer\s+([\w-]+)\s*\{/g)].map((match) => match[1]),
)
for (const layer of manifest.cascadeLayerOrder) {
  if (!loadedLayers.has(layer)) errors.push(`cascade layer has no explicit block: ${layer}`)
}

const entryGraph = await collectEntryGraph(entrypoint)
const allowedDirectImports = new Set(manifest.directStyleImportAllowlist)
const observedDirectImports = new Set<string>()
const directStyleTargets = new Set<string>()
const observedEntrypointImporters = new Set<string>()

for (const scriptFile of scriptFiles) {
  const source = await readFile(scriptFile, 'utf8')
  for (const match of source.matchAll(/import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+\.(?:css|scss))['"]/g)) {
    const target = await resolveStyleReference(scriptFile, match[1])
    if (!target) {
      errors.push(`${workspacePath(scriptFile)} imports a missing style file: ${match[1]}`)
      continue
    }
    if (target === entrypoint) {
      observedEntrypointImporters.add(workspacePath(scriptFile))
      continue
    }

    const descriptor = `${workspacePath(scriptFile)} -> ${workspacePath(target)}`
    observedDirectImports.add(descriptor)
    directStyleTargets.add(target)
    if (!allowedDirectImports.has(descriptor)) {
      errors.push(`direct style import is not allowlisted: ${descriptor}`)
    }
  }
}

if (
  observedEntrypointImporters.size !== 1 ||
  !observedEntrypointImporters.has(manifest.styleEntrypointImporter)
) {
  errors.push(
    `style entrypoint must be imported only by ${manifest.styleEntrypointImporter}; observed: ${[...observedEntrypointImporters].sort().join(', ') || 'none'}`,
  )
}

for (const descriptor of allowedDirectImports) {
  if (!observedDirectImports.has(descriptor)) {
    errors.push(`stale directStyleImportAllowlist entry: ${descriptor}`)
  }
}

const lazyStyleEntrypoints = new Map(
  Object.entries(manifest.lazyStyleEntrypoints).map(([path, layer]) => [
    resolve(workspaceRoot, path),
    layer,
  ]),
)
for (const [lazyEntrypoint, expectedLayer] of lazyStyleEntrypoints) {
  if (!directStyleTargets.has(lazyEntrypoint)) {
    errors.push(`lazy style entrypoint must be directly imported: ${workspacePath(lazyEntrypoint)}`)
    continue
  }
  const source = await readFile(lazyEntrypoint, 'utf8')
  const layers = [...source.matchAll(/@layer\s+([\w-]+)\s*\{/g)].map((match) => match[1])
  if (layers.length !== 1 || layers[0] !== expectedLayer) {
    errors.push(
      `lazy style entrypoint ${workspacePath(lazyEntrypoint)} must declare only @layer ${expectedLayer}`,
    )
  }
}
for (const directStyleTarget of directStyleTargets) {
  const targetPath = workspacePath(directStyleTarget)
  if (
    targetPath !== 'src/styles/tailwind.css' &&
    !lazyStyleEntrypoints.has(directStyleTarget)
  ) {
    errors.push(`direct style target must be a declared lazy entrypoint: ${targetPath}`)
  }
}

const completeStyleGraph = new Set(entryGraph)
for (const lazyEntrypoint of lazyStyleEntrypoints.keys()) {
  for (const styleFile of await collectEntryGraph(lazyEntrypoint)) {
    completeStyleGraph.add(styleFile)
  }
}

for (const styleFile of styleFiles) {
  if (!completeStyleGraph.has(styleFile) && !directStyleTargets.has(styleFile)) {
    errors.push(`style file is outside the single-entry graph: ${workspacePath(styleFile)}`)
  }
}

const utilityPath = resolve(workspaceRoot, manifest.utilityContract.source)
if (!(await isFile(utilityPath))) {
  errors.push(`utilityContract.source must point to an existing SCSS file: ${manifest.utilityContract.source}`)
} else if (!entryGraph.has(utilityPath)) {
  errors.push(`utility source is outside the single-entry graph: ${manifest.utilityContract.source}`)
} else {
  const { prefix, maxSelectors, maxBytes, maxGzipBytes } = manifest.utilityContract
  if (!/^[a-z][a-z0-9]*-$/.test(prefix)) {
    errors.push(`utility prefix must be a lowercase kebab prefix ending in "-": ${prefix}`)
  }

  const utilityCss = compile(utilityPath, { style: 'expanded' }).css
  const escapedPrefix = escapeRegExp(prefix)
  const expectedSelectorPattern = new RegExp(
    `:where\\(\\.(${escapedPrefix}[a-z0-9]+(?:-[a-z0-9]+)*)\\)\\s*\\{`,
    'g',
  )
  const utilitySelectors = [...utilityCss.matchAll(expectedSelectorPattern)].map(
    (match) => match[1],
  )
  const allUtilityBlocks = [...utilityCss.matchAll(/([^{}]+)\{/g)].filter((match) =>
    match[1].includes(`.${prefix}`),
  )
  const uniqueUtilitySelectors = new Set(utilitySelectors)
  const utilityBytes = Buffer.byteLength(utilityCss)
  const utilityGzipBytes = gzipSync(utilityCss).byteLength

  if (allUtilityBlocks.length !== utilitySelectors.length) {
    errors.push('every utility selector must use one zero-specificity :where(.u-*) selector')
  }
  if (uniqueUtilitySelectors.size !== utilitySelectors.length) {
    errors.push('utility selectors must be unique')
  }
  if (utilitySelectors.length > maxSelectors) {
    errors.push(`utility selector budget exceeded: ${utilitySelectors.length} > ${maxSelectors}`)
  }
  if (utilityBytes > maxBytes) {
    errors.push(`utility byte budget exceeded: ${utilityBytes} > ${maxBytes}`)
  }
  if (utilityGzipBytes > maxGzipBytes) {
    errors.push(`utility gzip budget exceeded: ${utilityGzipBytes} > ${maxGzipBytes}`)
  }
  if (/!important\b/.test(utilityCss)) {
    errors.push('utilities must not use !important')
  }
  if (/\[data-theme(?=[\s=\]])/.test(utilityCss)) {
    errors.push('utilities must not contain data-theme selectors')
  }

  const utilityReferencePattern = new RegExp(
    `\\b${escapedPrefix}[a-z0-9]+(?:-[a-z0-9]+)*\\b`,
    'g',
  )
  const utilityDefinitionPattern = new RegExp(
    `\\.(${escapedPrefix}[a-z0-9]+(?:-[a-z0-9]+)*)\\b`,
    'g',
  )
  for (const styleFile of styleFiles) {
    if (styleFile === utilityPath) continue
    const source = await readFile(styleFile, 'utf8')
    const definitions = [...source.matchAll(utilityDefinitionPattern)].map(
      (match) => match[1],
    )
    if (definitions.length > 0) {
      errors.push(
        `utility classes may only be defined by ${manifest.utilityContract.source}: ${workspacePath(styleFile)} defines ${[...new Set(definitions)].join(', ')}`,
      )
    }
  }
  for (const scriptFile of scriptFiles) {
    const source = await readFile(scriptFile, 'utf8')
    if (
      new RegExp(`${escapedPrefix}\\$\\{`).test(source) ||
      new RegExp(`['\"\\\`]${escapedPrefix}[^'\"\\\`]*['\"\\\`]\\s*\\+`).test(source) ||
      new RegExp(`\\+\\s*['\"\\\`]${escapedPrefix}`).test(source)
    ) {
      errors.push(`utility classes must be complete static strings: ${workspacePath(scriptFile)}`)
    }
    for (const utility of source.match(utilityReferencePattern) ?? []) {
      if (!uniqueUtilitySelectors.has(utility)) {
        errors.push(`unknown utility class in ${workspacePath(scriptFile)}: ${utility}`)
      }
    }
  }

  console.log(
    `[style-contracts] utilities: ${utilitySelectors.length} selectors, ${utilityBytes} bytes, ${utilityGzipBytes} gzip bytes`,
  )
}

const customPropertyReferences = new Set<string>()
const customPropertyDefinitions = new Set<string>()
for (const file of [...styleFiles, ...scriptFiles]) {
  const source = await readFile(file, 'utf8')
  const isStyle = styleExtensions.has(extname(file))
  for (const match of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
    customPropertyReferences.add(match[1])
  }
  for (const definition of collectCustomPropertyDefinitions(source, isStyle)) {
    customPropertyDefinitions.add(definition)
  }
}

const allowedCustomPropertyReferences = new Set(manifest.customPropertyReferenceAllowlist)
const forbiddenCustomPropertyPatterns = manifest.forbiddenCustomPropertyPatterns.map(
  (pattern) => new RegExp(pattern),
)
for (const definition of customPropertyDefinitions) {
  if (forbiddenCustomPropertyPatterns.some((pattern) => pattern.test(definition))) {
    errors.push(`forbidden legacy custom property definition: ${definition}`)
  }
}
for (const reference of customPropertyReferences) {
  if (!customPropertyDefinitions.has(reference) && !allowedCustomPropertyReferences.has(reference)) {
    errors.push(`undefined custom property reference: ${reference}`)
  }
}
for (const reference of allowedCustomPropertyReferences) {
  if (customPropertyDefinitions.has(reference) || !customPropertyReferences.has(reference)) {
    errors.push(`stale customPropertyReferenceAllowlist entry: ${reference}`)
  }
}

const observedDataThemeSelectors: Record<string, number> = {}
const observedImportantDeclarations: Record<string, number> = {}
for (const styleFile of styleFiles) {
  const source = await readFile(styleFile, 'utf8')
  const importantCount = [...source.matchAll(/!important\b/g)].length
  if (importantCount > 0) observedImportantDeclarations[workspacePath(styleFile)] = importantCount
  const count = [...source.matchAll(/\[data-theme(?=[\s=\]])/g)].length
  if (count > 0) observedDataThemeSelectors[workspacePath(styleFile)] = count
}

const importantFiles = new Set([
  ...Object.keys(manifest.importantDeclarationAllowlist),
  ...Object.keys(observedImportantDeclarations),
])
for (const file of importantFiles) {
  const expected = manifest.importantDeclarationAllowlist[file] ?? 0
  const observed = observedImportantDeclarations[file] ?? 0
  if (expected !== observed) {
    errors.push(`!important declaration count changed in ${file}: expected ${expected}, observed ${observed}`)
  }
}

const dataThemeFiles = new Set([
  ...Object.keys(manifest.dataThemeSelectorAllowlist),
  ...Object.keys(observedDataThemeSelectors),
])
for (const file of dataThemeFiles) {
  const expected = manifest.dataThemeSelectorAllowlist[file] ?? 0
  const observed = observedDataThemeSelectors[file] ?? 0
  if (expected !== observed) {
    errors.push(`data-theme selector count changed in ${file}: expected ${expected}, observed ${observed}`)
  }
}

if (errors.length > 0) {
  console.error('[style-contracts] failed')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  `[style-contracts] ok: ${styleFiles.length} style files, ${customPropertyReferences.size} custom property references, ${Object.values(observedImportantDeclarations).reduce((sum, count) => sum + count, 0)} allowlisted !important declarations, ${Object.values(observedDataThemeSelectors).reduce((sum, count) => sum + count, 0)} data-theme selectors`,
)
