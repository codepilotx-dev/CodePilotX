import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import {
  desktopAlias,
  desktopMacroDefines,
  desktopOutDir,
} from './vite.desktop.shared.js'

export default defineConfig({
  root: 'apps/desktop/src/renderer',
  base: './',
  resolve: { alias: desktopAlias },
  define: desktopMacroDefines,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: false,
    },
  },
  build: {
    outDir: resolve(desktopOutDir, 'renderer'),
    emptyOutDir: false,
    target: 'chrome120',
    sourcemap: false,
  },
})
