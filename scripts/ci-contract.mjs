import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

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
  'rust/codex-rs/vendor/**',
  'rust/codex-rs/tui/src/insert_history.rs',
  'rust/codex-rs/tui/src/markdown_render_tests.rs',
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

export function validateCiWorkflow(workflow, packageScripts, repositoryRoot) {
  const jobs = workflow?.jobs
  if (!jobs || typeof jobs !== 'object') throw new Error('CI workflow has no jobs')

  const steps = Object.values(jobs).flatMap(job => job?.steps ?? [])
  const workflowCommands = steps
    .map(step => step?.run)
    .filter(command => typeof command === 'string')
    .join('\n')

  for (const match of workflowCommands.matchAll(/bun run ([\w:-]+)/g)) {
    if (!packageScripts[match[1]]) {
      throw new Error(`CI references missing package script: ${match[1]}`)
    }
  }
  const commands = expandPackageScriptCommands(workflowCommands, packageScripts)
  for (const step of steps) {
    const workingDirectory = step?.['working-directory']
    if (workingDirectory && !existsSync(resolve(repositoryRoot, workingDirectory))) {
      throw new Error(`CI working-directory does not exist: ${workingDirectory}`)
    }
  }

  const requiredFragments = [
    'bun install --frozen-lockfile',
    'bun run test',
    'bun run desktop:typecheck',
    'bun run desktop:css:check',
    'cargo metadata --locked',
    'cargo fmt --all -- --check',
    'schema_fixtures',
    'write_schema_fixtures',
    'git diff --exit-code',
    'bun run desktop:rust-sidecar:prepare',
    'verify-sidecar',
    'whitespace',
  ]
  const missing = requiredFragments.filter(fragment => !commands.includes(fragment))
  if (missing.length > 0) {
    throw new Error(`CI is missing required gates: ${missing.join(', ')}`)
  }
}

function expandPackageScriptCommands(commands, packageScripts) {
  const expanded = [commands]
  const visited = new Set()
  const queue = [...commands.matchAll(/bun run ([\w:-]+)/g)].map(match => match[1])
  while (queue.length > 0) {
    const name = queue.shift()
    if (visited.has(name)) continue
    visited.add(name)
    const script = packageScripts[name]
    if (!script) continue
    expanded.push(script)
    queue.push(...[...script.matchAll(/bun run ([\w:-]+)/g)].map(match => match[1]))
  }
  return expanded.join('\n')
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
    normalized.startsWith('rust/codex-rs/skills/src/assets/') ||
    normalized.startsWith('rust/codex-rs/vendor/') ||
    normalized === 'rust/codex-rs/tui/src/insert_history.rs' ||
    normalized === 'rust/codex-rs/tui/src/markdown_render_tests.rs'
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

function runTrackedTests() {
  const tests = discoverTrackedBunTestsFromPaths(gitTrackedPaths())
  if (tests.length === 0) throw new Error('No tracked Bun tests discovered')
  const executable = resolveBunExecutable()
  console.log(`[test-discovery] Running ${tests.length} tracked Bun test files in isolation.`)
  for (const [index, args] of buildBunTestInvocations(tests).entries()) {
    console.log(`[test-discovery] ${index + 1}/${tests.length} ${args.at(-1)}`)
    const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
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

function verifySidecar(directory = resolve(root, 'dist/desktop-rust-sidecar')) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Sidecar resource directory is missing: ${directory}`)
  }
  const expected = process.platform === 'win32'
    ? 'codepilotx-app-server.exe'
    : 'codepilotx-app-server'
  const files = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile())
  if (files.length !== 1 || files[0].name !== expected) {
    throw new Error(
      `Expected exactly ${expected} in ${directory}; found ${files.map(file => file.name).join(', ')}`,
    )
  }
  console.log(`[ci-contract] Verified one packaged sidecar: ${expected}`)
}

function checkWhitespace(base) {
  if (!base) throw new Error('Whitespace check requires a base commit')
  const pathspecs = ['.', ...WHITESPACE_EXCLUSIONS.map(path => `:(exclude)${path}`)]
  const result = spawnSync(
    'git',
    ['diff', '--check', `${base}...HEAD`, '--', ...pathspecs],
    { cwd: root, stdio: 'inherit' },
  )
  process.exit(result.status ?? 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2)
  if (command === 'test') runTrackedTests()
  else if (command === 'validate') validateWorkflowFiles()
  else if (command === 'verify-sidecar') verifySidecar(argument)
  else if (command === 'whitespace') checkWhitespace(argument)
  else throw new Error(`Unknown ci-contract command: ${command ?? '<missing>'}`)
}
