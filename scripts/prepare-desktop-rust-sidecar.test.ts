import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  RUST_SIDECAR_RELEASE_ARGS,
  parseCargoSourceConfigArgs,
} from './rust-sidecar-build-contract.mjs'

const root = resolve(import.meta.dir, '..')

test('desktop packaging builds one locked stripped release Rust sidecar', async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }
  const prepareScript = await readFile(
    resolve(root, 'scripts', 'prepare-desktop-rust-sidecar.mjs'),
    'utf8',
  )
  const builderConfig = await readFile(
    resolve(root, 'apps', 'desktop', 'electron-builder.config.cjs'),
    'utf8',
  )
  const importedBuilderConfig = await import(
    resolve(root, 'apps', 'desktop', 'electron-builder.config.cjs')
  )

  expect(packageJson.scripts['desktop:rust-sidecar:prepare']).toBe(
    'node scripts/prepare-desktop-rust-sidecar.mjs --release',
  )
  expect(packageJson.scripts['desktop:rust-sidecar:prepare:debug']).toBe(
    'node scripts/prepare-desktop-rust-sidecar.mjs',
  )
  for (const distScript of ['desktop:dist:win', 'desktop:dist:unpacked:win']) {
    const steps = packageJson.scripts[distScript].split(' && ')
    expect(steps).toContain('bun run desktop:rust-sidecar:prepare')
    expect(steps).not.toContain('bun run desktop:rust-sidecar:prepare:debug')
  }
  expect(prepareScript).toContain('resolveRustSidecarBuild')
  expect(RUST_SIDECAR_RELEASE_ARGS).toContain('--release')
  expect(RUST_SIDECAR_RELEASE_ARGS).toContain('--locked')
  expect(RUST_SIDECAR_RELEASE_ARGS).toContain('profile.release.strip="symbols"')
  expect(RUST_SIDECAR_RELEASE_ARGS).toContain('profile.release.lto=false')
  expect(
    parseCargoSourceConfigArgs([
      '--cargo-config',
      'source.crates-io.replace-with="rsproxy-sparse"',
    ]),
  ).toEqual([
    '--config',
    'source.crates-io.replace-with="rsproxy-sparse"',
  ])
  expect(() =>
    parseCargoSourceConfigArgs(['--cargo-config', 'profile.release.lto=true']),
  ).toThrow('source.*')
  expect(builderConfig.match(/from: 'dist\/desktop-rust-sidecar'/g)).toHaveLength(1)
  expect(builderConfig.match(/'dist\/desktop-rust-sidecar\/\*\*\/\*'/g) ?? []).toHaveLength(0)
  expect(builderConfig).toContain("to: 'desktop-rust-sidecar'")
  expect(importedBuilderConfig.default.files).not.toContain(
    'dist/desktop-rust-sidecar/**/*',
  )
  expect(importedBuilderConfig.default.asarUnpack).not.toContain(
    'dist/desktop-rust-sidecar/**/*',
  )
})

test('Rust sidecar build contract selects release and debug Cargo profiles', async () => {
  const buildContract = await import('./rust-sidecar-build-contract.mjs')

  expect(buildContract.resolveRustSidecarBuild?.([])).toEqual({
    profile: 'debug',
    args: ['build', '--locked', '-p', 'codepilotx-app-server'],
  })
  expect(buildContract.resolveRustSidecarBuild?.(['--release'])).toEqual({
    profile: 'release',
    args: RUST_SIDECAR_RELEASE_ARGS,
  })
})

test('desktop development awaits the debug Rust sidecar before startup', async () => {
  const devScript = await readFile(
    resolve(root, 'scripts', 'desktop-dev.mjs'),
    'utf8',
  )
  const prepareIndex = devScript.indexOf(
    "await run('bun', ['run', 'desktop:rust-sidecar:prepare:debug'])",
  )

  expect(prepareIndex).toBeGreaterThan(-1)
  expect(prepareIndex).toBeLessThan(
    devScript.indexOf('await startRendererServer()'),
  )
  expect(prepareIndex).toBeLessThan(devScript.lastIndexOf('startElectron()'))
})
