import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadConfigFromFile, type UserConfig } from 'vite'

const desktopRoot = import.meta.dir
const configFiles = [
  'vite.desktop.main.config.ts',
  'vite.desktop.preload.config.ts',
  'vite.desktop.config.ts',
]

async function loadDesktopConfig(
  configFile: string,
  mode: 'development' | 'production',
): Promise<UserConfig> {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode },
    resolve(desktopRoot, configFile),
  )
  if (!loaded) throw new Error(`Unable to load ${configFile}`)
  return loaded.config
}

test('desktop Vite configs define NODE_ENV from the active mode', async () => {
  for (const configFile of configFiles) {
    const production = await loadDesktopConfig(configFile, 'production')
    const development = await loadDesktopConfig(configFile, 'development')

    expect(production.define?.['process.env.NODE_ENV']).toBe('"production"')
    expect(development.define?.['process.env.NODE_ENV']).toBe('"development"')
    expect(production.define?.['process.env.USER_TYPE']).toBe('"external"')
  }
})

test('each desktop Vite build cleans only its own output directory', async () => {
  const configs = await Promise.all(
    configFiles.map(configFile => loadDesktopConfig(configFile, 'production')),
  )
  const outDirs = configs.map(config => config.build?.outDir)

  expect(outDirs).toEqual([
    resolve(desktopRoot, '../../dist/desktop/main'),
    resolve(desktopRoot, '../../dist/desktop/preload'),
    resolve(desktopRoot, '../../dist/desktop/renderer'),
  ])
  expect(configs.map(config => config.build?.emptyOutDir)).toEqual([
    true,
    true,
    true,
  ])
  expect(new Set(outDirs).size).toBe(configFiles.length)
})

test('desktop development build drivers explicitly select development mode', async () => {
  const repoRoot = resolve(desktopRoot, '../..')
  const [devDriver, debugDriver] = await Promise.all([
    readFile(resolve(repoRoot, 'scripts/desktop-dev.mjs'), 'utf8'),
    readFile(resolve(repoRoot, 'scripts/desktop-build-debug.mjs'), 'utf8'),
  ])

  const rendererServer = devDriver.match(
    /async function startRendererServer\(\) \{([\s\S]*?)\n\}/,
  )?.[1]
  const buildWatcher = devDriver.match(
    /async function startBuildWatcher\([^)]*\) \{([\s\S]*?)\n\}/,
  )?.[1]

  expect(rendererServer).toContain("mode: 'development'")
  expect(buildWatcher).toContain("mode: 'development'")
  expect(debugDriver).toContain("mode: 'development'")
})
