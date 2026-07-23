import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const QUICK_CHAT_RAW_BUDGET = Math.floor(1.5 * 1024 * 1024)
const QUICK_CHAT_GZIP_BUDGET = 475 * 1024

function quickChatBundleBudget(): Plugin {
  return {
    name: 'codepilotx-quick-chat-bundle-budget',
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
      for (const fileName of immediate) {
        const code = chunks.get(fileName)?.code ?? ''
        rawBytes += Buffer.byteLength(code)
        gzipBytes += gzipSync(code).byteLength
      }
      this.info(
        `Quick Chat immediate JS: ${(rawBytes / 1024).toFixed(1)} KiB raw / ${(gzipBytes / 1024).toFixed(1)} KiB gzip`,
      )
      if (rawBytes > QUICK_CHAT_RAW_BUDGET || gzipBytes > QUICK_CHAT_GZIP_BUDGET) {
        this.error(
          `Quick Chat immediate JS exceeds budget (${(rawBytes / 1024).toFixed(1)} KiB raw / ${(gzipBytes / 1024).toFixed(1)} KiB gzip; limits 1536 KiB / 475 KiB)`,
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), react(), quickChatBundleBudget()],
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
