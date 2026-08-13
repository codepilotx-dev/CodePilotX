import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

// Two-layer real gates for the /new route. The entry gate bounds the static
// shell graph (Vite entry plus `chunk.imports`), while each surface gate
// bounds the interactive first screen graph reachable from explicit module
// manifests. Raw JS is the primary metric because the desktop server returns
// Bun.file without Content-Encoding; gzip stays as a regression aid. Ceilings
// are tightened to final measured values × 1.05 (rounded up to 5 KiB) after
// the optimization batches landed, and stay below the initial ceilings.
const ENTRY_RAW_BUDGET_KIB = 1115
const ENTRY_GZIP_BUDGET_KIB = 355
const SURFACE_RAW_BUDGET_KIB = 1430
const SURFACE_GZIP_BUDGET_KIB = 455
const CSS_RAW_BUDGET_KIB = 440
const CSS_RAW_BUDGET = CSS_RAW_BUDGET_KIB * 1024
const rootPackage = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
) as { version: string }

const RENDERER_SRC_ROOT = resolve(__dirname, 'src')

// The startup splash in index.html reuses the Electron whale icon directly
// from apps/desktop/build; emit it into the renderer output without keeping a
// second copy of the icon in this workspace.
const WHALE_ICON_PATH = resolve(__dirname, '..', 'build', 'whale-icon.svg')
const WHALE_ICON_URL = '/whale-icon.svg'

function startupSplashAssets(): Plugin {
  return {
    name: 'codepilotx-startup-splash-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== WHALE_ICON_URL) return next()
        res.setHeader('Content-Type', 'image/svg+xml')
        res.end(readFileSync(WHALE_ICON_PATH))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'whale-icon.svg',
        source: readFileSync(WHALE_ICON_PATH),
      })
    },
  }
}

// Module manifests of the three /new interactive first screens. Every listed
// module must be part of the build output; the build fails otherwise so the
// manifests cannot silently drift from the source tree.
const NEW_SURFACE_COMMON_MODULES = [
  'features/layout/shell/DesktopLayout.tsx',
  'features/session/QuickChatView.tsx',
  'features/session/composer/DesktopComposer.tsx',
  'features/session/composer/ComposerEditor.tsx',
] as const

const NEW_SURFACE_MODULES: Record<string, readonly string[]> = {
  coding: [
    ...NEW_SURFACE_COMMON_MODULES,
    'features/session/CodingHeadingTransition.tsx',
    'features/session/NewSessionSuggestionPanel.tsx',
  ],
  working: [
    ...NEW_SURFACE_COMMON_MODULES,
    'features/session/WorkingNewSessionView.tsx',
  ],
  chat: [
    ...NEW_SURFACE_COMMON_MODULES,
    'features/session/ChatNewSessionView.tsx',
  ],
}

type BundleChunk = {
  fileName: string
  isEntry: boolean
  code: string
  imports: string[]
  modules: Record<string, { renderedLength: number }>
  viteMetadata?: { importedCss?: string[] }
}

function normalizeSlashes(path: string): string {
  return path.replaceAll('\\', '/')
}

function normalizeModuleId(moduleId: string): string {
  return normalizeSlashes(moduleId.split('?', 1)[0] ?? moduleId)
}

/** Collect the static graph reachable from the given chunks via `chunk.imports`. */
function collectStaticGraph(
  chunks: Map<string, BundleChunk>,
  rootFileNames: Iterable<string>,
): Set<string> {
  const visited = new Set<string>()
  const visit = (fileName: string): void => {
    if (visited.has(fileName)) return
    const chunk = chunks.get(fileName)
    if (!chunk) return
    visited.add(fileName)
    for (const imported of chunk.imports) visit(imported)
  }
  for (const fileName of rootFileNames) visit(fileName)
  return visited
}

/** Locate chunks that contain any of the normalized absolute source paths. */
function findChunksContainingModules(
  chunks: Map<string, BundleChunk>,
  sourceModulePaths: readonly string[],
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const targets = new Set(sourceModulePaths.map(normalizeSlashes))
  for (const [fileName, chunk] of chunks) {
    const hit = new Set<string>()
    for (const moduleId of Object.keys(chunk.modules)) {
      const normalized = normalizeModuleId(moduleId)
      if (targets.has(normalized)) hit.add(normalized)
    }
    if (hit.size > 0) found.set(fileName, hit)
  }
  return found
}

function measureGraph(
  chunks: Map<string, BundleChunk>,
  fileNames: Iterable<string>,
): { rawBytes: number; gzipBytes: number } {
  let rawBytes = 0
  let gzipBytes = 0
  for (const fileName of fileNames) {
    const chunk = chunks.get(fileName)
    const code = chunk?.code ?? ''
    rawBytes += Buffer.byteLength(code)
    gzipBytes += gzipSync(code).byteLength
  }
  return { rawBytes, gzipBytes }
}

function cssUnionBytes(
  chunks: Map<string, BundleChunk>,
  assets: Record<string, { type?: string; source?: unknown }>,
  fileNames: Iterable<string>,
): number {
  const cssFiles = new Set<string>()
  for (const fileName of fileNames) {
    for (const cssFile of chunks.get(fileName)?.viteMetadata?.importedCss ?? []) {
      cssFiles.add(cssFile)
    }
  }
  return [...cssFiles].reduce((total, fileName) => {
    const asset = assets[fileName]
    if (!asset || asset.type !== 'asset') {
      return total
    }
    if (typeof asset.source === 'string') {
      return total + Buffer.byteLength(asset.source)
    }
    return asset.source instanceof Uint8Array
      ? total + asset.source.byteLength
      : total
  }, 0)
}

function routeBundleBudget(): Plugin {
  return {
    name: 'codepilotx-route-bundle-budget',
    generateBundle(_options, bundle) {
      const chunks = new Map<string, BundleChunk>()
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue
        chunks.set(item.fileName, item as unknown as BundleChunk)
      }
      const entries = [...chunks.values()].filter(chunk => chunk.isEntry)

      // Layer one: the static entry shell graph.
      const entryGraph = collectStaticGraph(
        chunks,
        entries.map(chunk => chunk.fileName),
      )
      const entryMeasure = measureGraph(chunks, entryGraph)

      // Layer two: each /new surface interactive graph, rooted at the chunks
      // containing its manifest modules.
      const surfaceMeasures = new Map<string, {
        rawBytes: number
        gzipBytes: number
      }>()
      const surfaceGraphs = new Set<string>()
      for (const [surface, modules] of Object.entries(NEW_SURFACE_MODULES)) {
        const absolutePaths = modules.map(module =>
          normalizeSlashes(resolve(RENDERER_SRC_ROOT, module)),
        )
        const found = findChunksContainingModules(chunks, absolutePaths)
        const missingModules = absolutePaths.filter(
          path => ![...found.values()].some(hits => hits.has(path)),
        )
        if (missingModules.length > 0) {
          this.error(
            `Surface "${surface}" manifest modules missing from the build: ${missingModules.join(', ')}`,
          )
          continue
        }
        const graph = collectStaticGraph(
          chunks,
          [...entryGraph, ...found.keys()],
        )
        surfaceMeasures.set(surface, measureGraph(chunks, graph))
        for (const fileName of graph) surfaceGraphs.add(fileName)
      }

      const interactiveCssBytes = cssUnionBytes(chunks, bundle, surfaceGraphs)

      const largestChunk = [...chunks.values()]
        .map((chunk: any) => ({
          fileName: chunk.fileName,
          rawBytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code).byteLength,
        }))
        .sort((left, right) => right.rawBytes - left.rawBytes)[0]
      const largestImmediateModules = [...entryGraph]
        .flatMap(fileName => {
          const chunk = chunks.get(fileName)
          return Object.entries(chunk?.modules ?? {}).map(([id, details]: [string, any]) => ({
            id,
            renderedLength: details.renderedLength as number,
          }))
        })
        .sort((left, right) => right.renderedLength - left.renderedLength)
        .slice(0, 10)

      this.info(
        `Renderer entry static JS: ${(entryMeasure.rawBytes / 1024).toFixed(1)} KiB raw / ${(entryMeasure.gzipBytes / 1024).toFixed(1)} KiB gzip`,
      )
      for (const [surface, measure] of surfaceMeasures) {
        this.info(
          `/new?surface=${surface} interactive JS: ${(measure.rawBytes / 1024).toFixed(1)} KiB raw / ${(measure.gzipBytes / 1024).toFixed(1)} KiB gzip (+${((measure.rawBytes - entryMeasure.rawBytes) / 1024).toFixed(1)} KiB raw vs entry)`,
        )
      }
      this.info(
        `/new interactive CSS union: ${(interactiveCssBytes / 1024).toFixed(1)} KiB raw`,
      )
      if (largestChunk) {
        this.info(
          `Largest JS chunk: ${largestChunk.fileName} (${(largestChunk.rawBytes / 1024).toFixed(1)} KiB raw / ${(largestChunk.gzipBytes / 1024).toFixed(1)} KiB gzip)`,
        )
      }
      this.info(
        `/new largest modules: ${largestImmediateModules.map(module => `${module.id.replaceAll('\\', '/').split('/node_modules/').at(-1)} (${(module.renderedLength / 1024).toFixed(1)} KiB)`).join(', ')}`,
      )
      if (entryMeasure.rawBytes > ENTRY_RAW_BUDGET_KIB * 1024) {
        this.error(
          `Renderer entry static JS exceeds budget (${(entryMeasure.rawBytes / 1024).toFixed(1)} KiB raw; limit ${ENTRY_RAW_BUDGET_KIB} KiB)`,
        )
      }
      if (entryMeasure.gzipBytes > ENTRY_GZIP_BUDGET_KIB * 1024) {
        this.error(
          `Renderer entry static JS exceeds budget (${(entryMeasure.gzipBytes / 1024).toFixed(1)} KiB gzip; limit ${ENTRY_GZIP_BUDGET_KIB} KiB)`,
        )
      }
      for (const [surface, measure] of surfaceMeasures) {
        if (measure.rawBytes > SURFACE_RAW_BUDGET_KIB * 1024) {
          this.error(
            `/new?surface=${surface} interactive JS exceeds budget (${(measure.rawBytes / 1024).toFixed(1)} KiB raw; limit ${SURFACE_RAW_BUDGET_KIB} KiB)`,
          )
        }
        if (measure.gzipBytes > SURFACE_GZIP_BUDGET_KIB * 1024) {
          this.error(
            `/new?surface=${surface} interactive JS exceeds budget (${(measure.gzipBytes / 1024).toFixed(1)} KiB gzip; limit ${SURFACE_GZIP_BUDGET_KIB} KiB)`,
          )
        }
      }
      if (interactiveCssBytes > CSS_RAW_BUDGET) {
        this.error(
          `/new interactive CSS union exceeds budget (${(interactiveCssBytes / 1024).toFixed(1)} KiB raw; limit ${CSS_RAW_BUDGET_KIB} KiB)`,
        )
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    react(),
    routeBundleBudget(),
    startupSplashAssets(),
  ],
  define: {
    __CODEPILOTX_VERSION__: JSON.stringify(rootPackage.version),
  },
  resolve: {
    alias: {
      '@codepilotx/core': resolve(__dirname, 'src/shims/core'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['cmdk'],
  },
  build: {
    outDir: '../../../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [
        resolve(__dirname),
        resolve(__dirname, '..', 'build'),
      ],
    },
    strictPort: true,
    // 页面经动态端口的 Agent 提供，但 HMR WebSocket 必须直连固定的 Renderer 端口。
    hmr:
      mode === 'performance'
        ? false
        : mode === 'visual'
          ? undefined
          : {
              protocol: 'ws',
              host: '127.0.0.1',
              port: 7788,
              clientPort: 7788,
            },
  },
}))
