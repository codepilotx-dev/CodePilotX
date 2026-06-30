import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopToolchainService } from './desktopToolchainService.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

test('desktop toolchain uses manifest path entries and deletes only managed root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-toolchain-'))
  tempRoots.push(root)
  const platform = `${process.platform}-${process.arch}`
  const packagedRoot = join(
    root,
    'resources',
    'app.asar.unpacked',
    'dist',
    'desktop-runtime',
    platform,
  )
  const managedRoot = join(
    root,
    'userData',
    'runtime',
    'toolchains',
    'v1',
    platform,
  )
  await mkdir(join(packagedRoot, 'node'), { recursive: true })
  await mkdir(join(packagedRoot, 'python'), { recursive: true })
  await mkdir(managedRoot, { recursive: true })
  await writeFile(join(packagedRoot, 'packaged-marker'), 'packaged', 'utf8')
  await writeFile(join(managedRoot, 'managed-marker'), 'managed', 'utf8')
  await writeFile(
    join(managedRoot, 'desktop-runtime-manifest.json'),
    JSON.stringify({
      node: { version: 'v24.18.0', pathEntry: 'node' },
      python: {
        version: '3.12.8',
        pathEntry: 'python',
        scriptsPathEntry: 'python/Scripts',
      },
    }),
    'utf8',
  )

  const service = createDesktopToolchainService({
    resourcesPath: join(root, 'resources'),
    userDataPath: join(root, 'userData'),
    env: { PATH: '' },
  })

  const config = service.getEnvConfigSync(true)
  expect(config.root).toBe(managedRoot)
  expect(config.pathEntries).toEqual([
    join(managedRoot, 'node'),
    join(managedRoot, 'python'),
    join(managedRoot, 'python', 'Scripts'),
  ])

  const result = await service.deleteManagedToolchain(false)
  expect(result.ok).toBe(true)
  await expect(stat(managedRoot)).rejects.toThrow()
  expect((await stat(packagedRoot)).isDirectory()).toBe(true)
})
