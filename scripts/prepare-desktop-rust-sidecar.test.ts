import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { RUST_SIDECAR_RELEASE_ARGS } from './rust-sidecar-build-contract.mjs'
import { parseCargoSourceConfigArgs } from './rust-sidecar-build-contract.mjs'

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

  expect(packageJson.scripts['desktop:rust-sidecar:prepare']).toContain('--release')
  expect(prepareScript).toContain('RUST_SIDECAR_RELEASE_ARGS')
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
})
