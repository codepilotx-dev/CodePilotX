import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
  expect(prepareScript).toContain("'--release'")
  expect(prepareScript).toContain("'--locked'")
  expect(prepareScript).toContain('profile.release.strip')
  expect(builderConfig.match(/from: 'dist\/desktop-rust-sidecar'/g)).toHaveLength(1)
  expect(builderConfig.match(/'dist\/desktop-rust-sidecar\/\*\*\/\*'/g) ?? []).toHaveLength(0)
  expect(builderConfig).toContain("to: 'desktop-rust-sidecar'")
})
