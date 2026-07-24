import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const NEW_ROUTE_GZIP_BUDGET = 360 * 1024
const INITIAL_CSS_RAW_BUDGET = 460 * 1024

function routeBundleBudget(): Plugin {
  return {
    name: 'codepilotx-route-bundle-budget',
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter((item: any) => item.type === 'chunk')
          .map((chunk: any) => [chunk.fileName, chunk]),
      )
      const entries = [...chunks.values()].filter((chunk: any) => chunk.isEntry)
      const immediate = new Set<string>()
      const visit = (fileName: string): void => {
        if (immediate.has(fileName)) return
        const chunk = chunks.get(fileName)
        if (!chunk) return
        immediate.add(fileName)
        for (const imported of chunk.imports) visit(imported)
      }
      for (const entry of entries) visit(entry.fileName)

      let rawBytes = 0
      let gzipBytes = 0
      const initialCss = new Set<string>()
      for (const fileName of immediate) {
        const chunk = chunks.get(fileName)
        const code = chunk?.code ?? ''
        rawBytes += Buffer.byteLength(code)
        gzipBytes += gzipSync(code).byteLength
        for (const cssFile of chunk?.viteMetadata?.importedCss ?? []) {
          initialCss.add(cssFile)
        }
      }
      const initialCssBytes = [...initialCss].reduce((total, fileName) => {
        const asset = bundle[fileName]
        return total + (
          asset?.type === 'asset'
            ? Buffer.byteLength(asset.source)
            : 0
        )
      }, 0)
      const labsCss = new Set(
        [...chunks.values()]
          .filter((chunk: any) =>
            chunk.facadeModuleId?.replaceAll('\\', '/').endsWith('/features/labs/LabsPage.tsx'),
          )
          .flatMap((chunk: any) => [...(chunk.viteMetadata?.importedCss ?? [])]),
      )
      const largestChunk = [...chunks.values()]
        .map((chunk: any) => ({
          fileName: chunk.fileName,
          rawBytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code).byteLength,
        }))
        .sort((left, right) => right.rawBytes - left.rawBytes)[0]
      const largestImmediateModules = [...immediate]
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
        `/new immediate JS: ${(rawBytes / 1024).toFixed(1)} KiB raw / ${(gzipBytes / 1024).toFixed(1)} KiB gzip`,
      )
      this.info(`/new initial CSS: ${(initialCssBytes / 1024).toFixed(1)} KiB raw`)
      if (largestChunk) {
        this.info(
          `Largest JS chunk: ${largestChunk.fileName} (${(largestChunk.rawBytes / 1024).toFixed(1)} KiB raw / ${(largestChunk.gzipBytes / 1024).toFixed(1)} KiB gzip)`,
        )
      }
      this.info(
        `/new largest modules: ${largestImmediateModules.map(module => `${module.id.replaceAll('\\', '/').split('/node_modules/').at(-1)} (${(module.renderedLength / 1024).toFixed(1)} KiB)`).join(', ')}`,
      )
      if ([...labsCss].some(fileName => initialCss.has(fileName))) {
        this.error('Labs CSS leaked into the /new immediate dependency graph')
      }
      if (gzipBytes > NEW_ROUTE_GZIP_BUDGET) {
        this.error(
          `/new immediate JS exceeds budget (${(gzipBytes / 1024).toFixed(1)} KiB gzip; limit 360 KiB)`,
        )
      }
      if (initialCssBytes > INITIAL_CSS_RAW_BUDGET) {
        this.error(
          `/new initial CSS exceeds budget (${(initialCssBytes / 1024).toFixed(1)} KiB raw; limit 460 KiB)`,
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), react(), routeBundleBudget()],
  resolve: {
    alias: {
      '@codepilotx/core': resolve(__dirname, 'src/shims/core'),
    },
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
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: 7788,
      clientPort: 7788,
    },
  },
})
