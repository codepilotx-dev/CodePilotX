import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { desktopOutDir, nodeDesktopBuild } from './vite.desktop.shared.js'

export default defineConfig(({ mode }) =>
  nodeDesktopBuild(
    'apps/desktop/src/main/index.ts',
    resolve(desktopOutDir, 'main'),
    'index',
    ['es'],
    { mode },
  ),
)
