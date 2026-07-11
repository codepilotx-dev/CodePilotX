import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import {
  assertChangedTestsDiscovered,
  buildBunTestInvocations,
  buildProcessTreeTermination,
  buildWhitespaceDiffArgs,
  discoverTrackedBunTestsFromPaths,
  isWhitespaceExcluded,
  normalizeWhitespaceBase,
  resolveBunExecutable,
  runTestPool,
  selectTestShard,
  validateCiWorkflow,
  validateSidecarResourceContract,
  verifySidecarDirectory,
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

test('tracked tests use stable shards and bounded concurrency while aggregating failures', async () => {
  expect(selectTestShard(['a', 'b', 'c', 'd', 'e'], 1, 2)).toEqual(['b', 'd'])

  let active = 0
  let maxActive = 0
  const completed: string[] = []
  await expect(
    runTestPool(['a', 'b', 'c', 'd'], {
      concurrency: 2,
      timeoutMs: 100,
      runTest: async (path) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await Bun.sleep(5)
        active -= 1
        completed.push(path)
        return { status: path === 'b' ? 1 : 0, timedOut: false }
      },
    }),
  ).rejects.toThrow('b')
  expect(maxActive).toBe(2)
  expect(completed.sort()).toEqual(['a', 'b', 'c', 'd'])
})

test('hard timeout terminates the complete child process tree', () => {
  expect(buildProcessTreeTermination(42, 'win32')).toEqual({
    command: 'taskkill',
    args: ['/PID', '42', '/T', '/F'],
  })
  expect(buildProcessTreeTermination(42, 'linux')).toEqual({
    signalTarget: -42,
    signal: 'SIGKILL',
  })
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

test('packaged sidecar verification rejects nested extra files', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sidecar-contract-'))
  try {
    const expected = process.platform === 'win32'
      ? 'codepilotx-app-server.exe'
      : 'codepilotx-app-server'
    await writeFile(resolve(directory, expected), 'binary')
    expect(() => verifySidecarDirectory(directory, process.platform)).not.toThrow()
    await mkdir(resolve(directory, 'nested'))
    await writeFile(resolve(directory, 'nested', 'extra.txt'), 'unexpected')
    expect(() => verifySidecarDirectory(directory, process.platform)).toThrow(
      'exactly',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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
  expect(isWhitespaceExcluded('rust/codex-rs/vendor/bubblewrap/COPYING')).toBe(false)
  expect(isWhitespaceExcluded('rust/codex-rs/tui/src/insert_history.rs')).toBe(
    false,
  )
  expect(
    isWhitespaceExcluded('rust/codex-rs/tui/src/markdown_render_tests.rs'),
  ).toBe(false)
})

test('whitespace diff uses git pathspec exclusions and a safe zero-sha fallback', () => {
  expect(normalizeWhitespaceBase('0000000000000000000000000000000000000000')).toBe(
    'HEAD^',
  )
  const args = buildWhitespaceDiffArgs('HEAD^')
  expect(args.slice(0, 4)).toEqual(['diff', '--check', 'HEAD^...HEAD', '--'])
  expect(args).toContain(':(exclude)rust/codex-rs/**/snapshots/**')
  expect(args.some(arg => arg.includes('vendor/**'))).toBe(false)
})

test('whitespace gate reports a tracked path containing spaces through real git', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'whitespace-git-'))
  try {
    const env = {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'ci@example.invalid',
      GIT_AUTHOR_NAME: 'CI Contract',
      GIT_COMMITTER_EMAIL: 'ci@example.invalid',
      GIT_COMMITTER_NAME: 'CI Contract',
    }
    const command = process.platform === 'win32'
      ? [
          'powershell', '-NoProfile', '-Command',
          "git init | Out-Null; Set-Content -NoNewline baseline.txt \"clean`n\"; git add .; git commit --no-gpg-sign -m baseline | Out-Null; New-Item -ItemType Directory 'dir with space' | Out-Null; Set-Content -NoNewline 'dir with space/bad.txt' \"bad  `n\"; git add .; git commit --no-gpg-sign -m bad | Out-Null; git diff --check HEAD^...HEAD -- .; exit $LASTEXITCODE",
        ]
      : [
          'sh', '-c',
          "git init >/dev/null && printf 'clean\\n' > baseline.txt && git add . && git commit --no-gpg-sign -m baseline >/dev/null && mkdir 'dir with space' && printf 'bad  \\n' > 'dir with space/bad.txt' && git add . && git commit --no-gpg-sign -m bad >/dev/null && git diff --check HEAD^...HEAD -- .",
        ]
    const result = Bun.spawnSync(command, { cwd: directory, env })
    expect(result.exitCode).not.toBe(0)
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)
    expect(output).toContain('dir with space/bad.txt')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)
