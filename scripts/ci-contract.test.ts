import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import {
  assertChangedTestsDiscovered,
  buildBunTestInvocations,
  discoverTrackedBunTestsFromPaths,
  isWhitespaceExcluded,
  resolveBunExecutable,
  validateCiWorkflow,
  validateSidecarResourceContract,
} from './ci-contract.mjs'

const root = resolve(import.meta.dir, '..')

test('tracked Bun test discovery includes source tests and excludes artifact trees', () => {
  const discovered = discoverTrackedBunTestsFromPaths([
    'packages/core/src/agent/workflow.test.ts',
    'apps/desktop/src/main/agentSession.test.tsx',
    'rust/codex-rs/target/debug/example.test.ts',
    'packages/core/src/types/generated/example.test.ts',
    'vendor/example.test.ts',
    'fixtures/example.test.ts',
  ])

  expect(discovered).toEqual([
    'apps/desktop/src/main/agentSession.test.tsx',
    'packages/core/src/agent/workflow.test.ts',
  ])
  expect(() =>
    assertChangedTestsDiscovered(discovered, [
      'packages/core/src/agent/workflow.test.ts',
      'apps/tui/src/query.test.ts',
    ]),
  ).toThrow('apps/tui/src/query.test.ts')
})

test('tracked test runner reuses the Bun executable provided by bun run', () => {
  expect(resolveBunExecutable({ npm_execpath: 'C:\\tools\\bun.exe' })).toBe(
    'C:\\tools\\bun.exe',
  )
  expect(resolveBunExecutable({ npm_execpath: '/usr/local/bin/bun' })).toBe(
    '/usr/local/bin/bun',
  )
  expect(resolveBunExecutable({ npm_execpath: '/usr/local/bin/npm' })).toBe('bun')
})

test('tracked tests run in isolated files to prevent global state collisions', () => {
  expect(buildBunTestInvocations(['b.test.ts', 'a.test.ts'])).toEqual([
    ['test', '--timeout', '30000', 'b.test.ts'],
    ['test', '--timeout', '30000', 'a.test.ts'],
  ])
})

test('CI workflow references executable repository commands and paths', async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }
  const workflow = parse(
    await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
  )

  expect(() => validateCiWorkflow(workflow, packageJson.scripts, root)).not.toThrow()
})

test('sidecar resource contract has one packaged binary at the resolver path', async () => {
  const builderConfig = await import(
    resolve(root, 'apps/desktop/electron-builder.config.cjs')
  )
  const resolverSource = await readFile(
    resolve(root, 'apps/desktop/src/main/rustSidecarRuntime.ts'),
    'utf8',
  )

  expect(() =>
    validateSidecarResourceContract(builderConfig.default, resolverSource),
  ).not.toThrow()
})

test('whitespace exclusions are limited to snapshots, frames, fixtures and assets', () => {
  expect(isWhitespaceExcluded('rust/codex-rs/tui/src/foo.rs')).toBe(false)
  expect(isWhitespaceExcluded('docs/rust-foundation-migration.md')).toBe(false)
  expect(
    isWhitespaceExcluded('rust/codex-rs/tui/src/snapshots/view.snap'),
  ).toBe(true)
  expect(isWhitespaceExcluded('rust/codex-rs/tui/frames/openai/frame_1.txt')).toBe(
    true,
  )
  expect(
    isWhitespaceExcluded('rust/codex-rs/app-server-protocol/schema/json/a.json'),
  ).toBe(true)
  expect(
    isWhitespaceExcluded('rust/codex-rs/apply-patch/tests/fixtures/input.txt'),
  ).toBe(true)
  expect(isWhitespaceExcluded('rust/codex-rs/vendor/bubblewrap/COPYING')).toBe(
    true,
  )
  expect(isWhitespaceExcluded('rust/codex-rs/tui/src/insert_history.rs')).toBe(
    true,
  )
  expect(
    isWhitespaceExcluded('rust/codex-rs/tui/src/markdown_render_tests.rs'),
  ).toBe(true)
})
