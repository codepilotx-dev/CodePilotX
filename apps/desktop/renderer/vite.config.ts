import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
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
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: 5173,
      clientPort: 5173,
    },
  },
})
