import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { RUST_SIDECAR_RELEASE_ARGS } from './rust-sidecar-build-contract.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const TEST_EXCLUDED_SEGMENTS = [
  '/generated/',
  '/vendor/',
  '/fixtures/',
  '/target/',
  '/node_modules/',
]

export const WHITESPACE_EXCLUSIONS = [
  'rust/codex-rs/**/snapshots/**',
  'rust/codex-rs/tui/frames/**',
  'rust/codex-rs/app-server-protocol/schema/**',
  'rust/codex-rs/apply-patch/tests/fixtures/**',
  'rust/codex-rs/shell-escalation/patches/**',
  'rust/codex-rs/skills/src/assets/**',
]

export function discoverTrackedBunTestsFromPaths(paths) {
  return paths
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => /\.test\.tsx?$/.test(path))
    .filter(path => {
      const normalized = `/${path.toLowerCase()}`
      return !TEST_EXCLUDED_SEGMENTS.some(segment => normalized.includes(segment))
    })
    .sort()
}

export function assertChangedTestsDiscovered(discovered, changedPaths) {
  const discoveredSet = new Set(discovered)
  const missing = discoverTrackedBunTestsFromPaths(changedPaths).filter(
    path => !discoveredSet.has(path),
  )
  if (missing.length > 0) {
    throw new Error(`Changed Bun tests were not discovered: ${missing.join(', ')}`)
  }
}

export function resolveBunExecutable(env = process.env) {
  const npmExecPath = env.npm_execpath
  return typeof npmExecPath === 'string' && /(^|[\\/])bun(?:\.exe)?$/i.test(npmExecPath)
    ? npmExecPath
    : 'bun'
}

export function buildBunTestInvocations(tests) {
  return tests.map(testPath => ['test', '--timeout', '30000', testPath])
}

export function selectTestShard(tests, index, total) {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
    throw new Error(`Invalid test shard ${index}/${total}`)
  }
  return tests.filter((_, testIndex) => testIndex % total === index)
}

export function buildProcessTreeTermination(pid, platform = process.platform) {
  if (platform === 'win32') {
    return { command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }
  }
  return { signalTarget: -pid, signal: 'SIGKILL' }
}

function terminateProcessTree(pid, platform = process.platform) {
  const termination = buildProcessTreeTermination(pid, platform)
  if ('command' in termination) {
    spawnSync(termination.command, termination.args, { stdio: 'ignore' })
  } else {
    try {
      process.kill(termination.signalTarget, termination.signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

function runBunTestFile(testPath, { executable, timeoutMs, cwd = root }) {
  return new Promise((resolveResult, reject) => {
    const args = ['test', '--timeout', '30000', testPath]
    const child = spawn(executable, args, {
      cwd,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) terminateProcessTree(child.pid)
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (status) => {
      clearTimeout(timer)
      resolveResult({ status: status ?? 1, timedOut })
    })
  })
}

export async function runTestPool(tests, options) {
  const concurrency = options.concurrency
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Invalid test concurrency: ${concurrency}`)
  }
  const failures = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, tests.length) }, async () => {
    while (cursor < tests.length) {
      const testPath = tests[cursor++]
      try {
        const result = await options.runTest(testPath, { timeoutMs: options.timeoutMs })
        if (result.status !== 0 || result.timedOut) {
          failures.push(`${testPath}${result.timedOut ? ' (timed out)' : ` (exit ${result.status})`}`)
        }
      } catch (error) {
        failures.push(`${testPath} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
  })
  await Promise.all(workers)
  if (failures.length > 0) {
    throw new Error(`Tracked Bun test failures:\n${failures.join('\n')}`)
  }
}

export function validateCiWorkflow(workflow, packageScripts, repositoryRoot) {
  const jobs = workflow?.jobs
  if (!jobs || typeof jobs !== 'object') throw new Error('CI workflow has no jobs')
  const records = []
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object' || !Array.isArray(job.steps)) {
      throw new Error(`CI job ${jobId} has no steps`)
    }
    if (!Number.isFinite(job['timeout-minutes'])) {
      throw new Error(`CI job ${jobId} has no timeout-minutes`)
    }
    const jobCwd = job.defaults?.run?.['working-directory'] ?? '.'
    for (const [stepIndex, step] of job.steps.entries()) {
      const cwd = step?.['working-directory'] ?? jobCwd
      if (!existsSync(resolve(repositoryRoot, cwd))) {
        throw new Error(`CI working-directory does not exist: ${cwd}`)
      }
      if (typeof step?.uses === 'string') validateActionVersion(step.uses)
      if (typeof step?.run !== 'string') continue
      for (const line of step.run.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
        const argv = parseCommandLine(line)
        if (argv.length === 0 || argv[0].startsWith('$')) continue
        records.push({ jobId, stepIndex, cwd, argv })
        if (argv[0] === 'bun' && argv[1] === 'run' && !packageScripts[argv[2]]) {
          throw new Error(`CI references missing package script: ${argv[2]}`)
        }
      }
    }
  }

  const has = (jobId, cwd, argv) => records.some(record =>
    (!jobId || record.jobId === jobId) &&
    (!cwd || record.cwd === cwd) &&
    argv.every((value, index) => record.argv[index] === value),
  )
  const required = [
    ['static', '.', ['bun', 'install', '--frozen-lockfile']],
    ['static', '.', ['bun', 'run', 'ci:validate']],
    ['static', '.', ['bun', 'run', 'desktop:typecheck']],
    ['static', '.', ['bun', 'run', 'desktop:css:check']],
    ['static', '.', ['node', 'scripts/ci-contract.mjs', 'whitespace']],
    ['test', '.', ['bun', 'run', 'test']],
    ['rust', 'rust/codex-rs', ['cargo', 'metadata', '--locked']],
    ['rust', 'rust/codex-rs', ['cargo', 'fmt', '--all', '--', '--check']],
    ['rust', 'rust/codex-rs', ['cargo', 'test', '-p', 'codepilotx-app-server-protocol']],
    ['windows-package', '.', ['bun', 'run', 'desktop:dist:unpacked:win']],
    ['windows-package', '.', ['node', 'scripts/ci-contract.mjs', 'verify-sidecar']],
  ]
  const missing = required.filter(([jobId, cwd, argv]) => !has(jobId, cwd, argv))
  if (missing.length > 0) {
    throw new Error(`CI is missing required structured gates: ${missing.map(([, , argv]) => argv.join(' ')).join(', ')}`)
  }
  const staticCheckout = jobs.static.steps.find(step => step?.uses === 'actions/checkout@v7')
  if (staticCheckout?.with?.['fetch-depth'] !== 0) {
    throw new Error('Static whitespace gate requires checkout fetch-depth: 0')
  }
  const testMatrix = jobs.test?.strategy?.matrix?.shard
  if (!Array.isArray(testMatrix) || testMatrix.length < 2) {
    throw new Error('CI test job must use a shard matrix')
  }
  const schemaFixture = records.find(record => record.argv.includes('schema_fixtures'))
  const schemaWriter = records.find(record => record.argv.includes('write_schema_fixtures'))
  const schemaDiff = records.find(record => record.argv[0] === 'git' && record.argv[1] === 'diff')
  if (!schemaFixture || !schemaWriter || !schemaDiff || schemaFixture.jobId !== schemaWriter.jobId || schemaWriter.jobId !== schemaDiff.jobId) {
    throw new Error('Schema fixture, generator and clean-diff must run in the same job')
  }
  for (const record of records.filter(record => record.argv[0] === 'cargo' && record.argv.includes('--release'))) {
    if (!record.argv.includes('--locked') || !record.argv.some(value => value.includes('profile.release.strip'))) {
      throw new Error(`Release cargo command is not locked and stripped: ${record.argv.join(' ')}`)
    }
  }
  if (
    !RUST_SIDECAR_RELEASE_ARGS.includes('--release') ||
    !RUST_SIDECAR_RELEASE_ARGS.includes('--locked') ||
    !RUST_SIDECAR_RELEASE_ARGS.some(value => value === 'profile.release.strip="symbols"') ||
    !RUST_SIDECAR_RELEASE_ARGS.some(value => value === 'profile.release.lto=false')
  ) {
    throw new Error('Desktop sidecar release build must be locked, stripped and disable LTO')
  }
}

function validateActionVersion(action) {
  const official = {
    'actions/checkout': 'v7',
    'actions/setup-node': 'v6',
    'actions/upload-artifact': 'v7',
    'oven-sh/setup-bun': 'v2',
  }
  const [name, version] = action.split('@')
  if (official[name] && version !== official[name]) {
    throw new Error(`${name} must use ${official[name]}, found ${version}`)
  }
}

function parseCommandLine(line) {
  if (/^(if |else|}|foreach |\$)/i.test(line)) return []
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)]
    .map(match => match[1] ?? match[2] ?? match[3])
}

export function validateSidecarResourceContract(builderConfig, resolverSource) {
  const resources = (builderConfig.extraResources ?? []).filter(
    resource => resource?.to === 'desktop-rust-sidecar',
  )
  if (resources.length !== 1) {
    throw new Error(`Expected one desktop-rust-sidecar resource, found ${resources.length}`)
  }
  if (resources[0].from !== 'dist/desktop-rust-sidecar') {
    throw new Error(`Unexpected sidecar resource source: ${resources[0].from}`)
  }
  if (!resolverSource.includes("resolve(runtime.resourcesPath, 'desktop-rust-sidecar', binaryName)")) {
    throw new Error('Packaged resolver does not use resourcesPath/desktop-rust-sidecar')
  }
}

export function isWhitespaceExcluded(path) {
  const normalized = path.replaceAll('\\', '/')
  return (
    /\/snapshots\//.test(normalized) ||
    normalized.startsWith('rust/codex-rs/tui/frames/') ||
    normalized.startsWith('rust/codex-rs/app-server-protocol/schema/') ||
    normalized.startsWith('rust/codex-rs/apply-patch/tests/fixtures/') ||
    normalized.startsWith('rust/codex-rs/shell-escalation/patches/') ||
    normalized.startsWith('rust/codex-rs/skills/src/assets/')
  )
}

function gitTrackedPaths() {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed')
  return result.stdout.split('\0').filter(Boolean)
}

async function runTrackedTests() {
  const allTests = discoverTrackedBunTestsFromPaths(gitTrackedPaths())
  const shardTotal = Number.parseInt(process.env.CODEPILOTX_TEST_SHARD_TOTAL ?? '1', 10)
  const shardIndex = Number.parseInt(process.env.CODEPILOTX_TEST_SHARD_INDEX ?? '0', 10)
  const tests = selectTestShard(allTests, shardIndex, shardTotal)
  if (tests.length === 0) throw new Error('No tracked Bun tests discovered')
  const executable = resolveBunExecutable()
  const concurrency = Number.parseInt(process.env.CODEPILOTX_TEST_CONCURRENCY ?? '4', 10)
  const timeoutMs = Number.parseInt(process.env.CODEPILOTX_TEST_FILE_TIMEOUT_MS ?? '120000', 10)
  console.log(`[test-discovery] Running shard ${shardIndex + 1}/${shardTotal}: ${tests.length}/${allTests.length} tracked Bun test files, concurrency ${concurrency}.`)
  await runTestPool(tests, {
    concurrency,
    timeoutMs,
    runTest: (testPath) => runBunTestFile(testPath, { executable, timeoutMs, cwd: root }),
  })
}

function validateWorkflowFiles() {
  const workflow = parse(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'))
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  validateCiWorkflow(workflow, packageJson.scripts, root)
  const builderConfig = createRequire(import.meta.url)(
    resolve(root, 'apps/desktop/electron-builder.config.cjs'),
  )
  const resolverSource = readFileSync(
    resolve(root, 'apps/desktop/src/main/rustSidecarRuntime.ts'),
    'utf8',
  )
  validateSidecarResourceContract(builderConfig, resolverSource)
  console.log('[ci-contract] Workflow commands, paths and sidecar resource agree.')
}

export function verifySidecarDirectory(directory, platform = process.platform) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Sidecar resource directory is missing: ${directory}`)
  }
  const expected = platform === 'win32'
    ? 'codepilotx-app-server.exe'
    : 'codepilotx-app-server'
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.push(relative(directory, path).replaceAll('\\', '/'))
    }
  }
  visit(directory)
  if (files.length !== 1 || files[0] !== expected) {
    throw new Error(
      `Expected exactly ${expected} in ${directory}; found ${files.join(', ')}`,
    )
  }
}

function verifySidecar(directory = resolve(root, 'dist/desktop-rust-sidecar')) {
  verifySidecarDirectory(directory)
  const expected = process.platform === 'win32' ? 'codepilotx-app-server.exe' : 'codepilotx-app-server'
  console.log(`[ci-contract] Verified one packaged sidecar: ${expected}`)
}

export function normalizeWhitespaceBase(base) {
  return !base || /^0+$/.test(base) ? 'HEAD^' : base
}

export function buildWhitespaceDiffArgs(base) {
  const pathspecs = ['.', ...WHITESPACE_EXCLUSIONS.map(path => `:(exclude)${path}`)]
  return ['diff', '--check', `${base}...HEAD`, '--', ...pathspecs]
}

export function runWhitespaceCheck(candidate, cwd = root) {
  let base = normalizeWhitespaceBase(candidate)
  const exists = spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd })
  if (exists.status !== 0) base = 'HEAD^'
  return spawnSync('git', buildWhitespaceDiffArgs(base), { cwd, encoding: 'utf8' })
}

function checkWhitespace(candidate) {
  const result = runWhitespaceCheck(candidate)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2)
  if (command === 'test') await runTrackedTests()
  else if (command === 'validate') validateWorkflowFiles()
  else if (command === 'verify-sidecar') verifySidecar(argument)
  else if (command === 'whitespace') checkWhitespace(argument)
  else throw new Error(`Unknown ci-contract command: ${command ?? '<missing>'}`)
}
