import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import {
  desktopAlias,
  desktopMacroDefines,
  desktopOutDir,
} from './vite.desktop.shared.js'

export default defineConfig({
  root: 'apps/desktop/src/renderer',
  resolve: { alias: desktopAlias },
  define: desktopMacroDefines,
  build: {
    outDir: resolve(desktopOutDir, 'renderer'),
    emptyOutDir: false,
    target: 'chrome120',
    sourcemap: true,
  },
})
