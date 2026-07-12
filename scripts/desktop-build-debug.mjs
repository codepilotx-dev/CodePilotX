import { resolve } from 'node:path'
import { build } from 'vite'

const repoRoot = resolve(import.meta.dirname, '..')

const configs = [
  'apps/desktop/vite.desktop.main.config.ts',
  'apps/desktop/vite.desktop.preload.config.ts',
  'apps/desktop/vite.desktop.config.ts',
]

for (const configFile of configs) {
  await build({
    configFile: resolve(repoRoot, configFile),
    mode: 'development',
    build: {
      sourcemap: true,
    },
  })
}
