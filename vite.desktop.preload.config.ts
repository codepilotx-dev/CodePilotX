import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { desktopOutDir, nodeDesktopBuild } from './vite.desktop.shared.js'

export default defineConfig(
  nodeDesktopBuild(
    'src/desktop/preload/index.ts',
    resolve(desktopOutDir, 'preload'),
    'index',
  ),
)
