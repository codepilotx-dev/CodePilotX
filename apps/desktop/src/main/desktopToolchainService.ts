import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  DesktopRuntimeBinaryName,
  DesktopRuntimeBinaryStatus,
  DesktopToolchainDiagnosticReport,
  DesktopToolchainInstallResult,
} from '../shared/types.js'
import type { DesktopToolchainEnvConfig } from './desktopRuntimeEnv.js'

const execFileAsync = promisify(execFile)
const TOOLCHAIN_VERSION = 'v1'
const MANIFEST_NAME = 'desktop-runtime-manifest.json'
const BINARY_NAMES: DesktopRuntimeBinaryName[] = [
  'node',
  'npm',
  'npx',
  'python',
  'pip',
]

export type DesktopToolchainService = {
  getEnvConfigSync(enabled: boolean): DesktopToolchainEnvConfig
  getEnvConfig(enabled: boolean): Promise<DesktopToolchainEnvConfig>
  getStatus(enabled: boolean): Promise<DesktopToolchainDiagnosticReport>
  diagnose(enabled: boolean): Promise<DesktopToolchainDiagnosticReport>
  reinstall(enabled: boolean): Promise<DesktopToolchainInstallResult>
  deleteManagedToolchain(enabled: boolean): Promise<DesktopToolchainInstallResult>
}

export function createDesktopToolchainService(options: {
  resourcesPath: string
  userDataPath: string
  env?: Record<string, string | undefined>
}): DesktopToolchainService {
  const env = options.env ?? process.env
  const packagedRoot = join(
    options.resourcesPath,
    'app.asar.unpacked',
    'dist',
    'desktop-runtime',
    platformKey(),
  )
  const managedRoot = join(
    options.userDataPath,
    'runtime',
    'toolchains',
    TOOLCHAIN_VERSION,
    platformKey(),
  )

  async function resolveRoot(): Promise<string | null> {
    if (await directoryExists(managedRoot)) return managedRoot
    if (await directoryExists(packagedRoot)) return packagedRoot
    return null
  }

  async function envConfig(enabled: boolean): Promise<DesktopToolchainEnvConfig> {
    const root = enabled ? await resolveRoot() : null
    return {
      enabled,
      root,
      pathEntries: root ? toolchainPathEntries(root) : [],
    }
  }

  function envConfigSync(enabled: boolean): DesktopToolchainEnvConfig {
    const root = enabled
      ? existsSync(managedRoot)
        ? managedRoot
        : existsSync(packagedRoot)
        ? packagedRoot
        : null
      : null
    return {
      enabled,
      root,
      pathEntries: root ? toolchainPathEntries(root) : [],
    }
  }

  async function report(
    enabled: boolean,
    includeVersions: boolean,
  ): Promise<DesktopToolchainDiagnosticReport> {
    const config = await envConfig(enabled)
    const toolchainSource =
      config.root === managedRoot
        ? 'managed'
        : config.root === packagedRoot
        ? 'packaged'
        : 'missing'
    const manifest = await readManifest(config.root)
    const binaries = await Promise.all(
      BINARY_NAMES.map(name =>
        inspectBinary(
          name,
          config.pathEntries,
          toolchainSource,
          env,
          includeVersions,
          targetVersionForBinary(name, manifest),
        ),
      ),
    )
    const diagnostic: DesktopToolchainDiagnosticReport = {
      enabled,
      root: config.root,
      managedRoot,
      packagedRoot,
      pathEntries: config.pathEntries,
      binaries,
    }
    if (includeVersions) {
      diagnostic.logPath = await writeDiagnosticLog(options.userDataPath, diagnostic)
    }
    return diagnostic
  }

  return {
    getEnvConfigSync: envConfigSync,
    getEnvConfig: envConfig,
    getStatus: enabled => report(enabled, false),
    diagnose: enabled => report(enabled, true),
    async reinstall(enabled) {
      try {
        await rm(managedRoot, { recursive: true, force: true })
        await mkdir(dirname(managedRoot), { recursive: true })
        let copiedFrom: string | null = null
        if (await directoryExists(packagedRoot)) {
          await cp(packagedRoot, managedRoot, { recursive: true })
          copiedFrom = packagedRoot
        } else {
          await mkdir(managedRoot, { recursive: true })
        }
        return {
          ok: true,
          root: managedRoot,
          copiedFrom,
          diagnostics: await report(enabled, true),
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          diagnostics: await report(enabled, true),
        }
      }
    },
    async deleteManagedToolchain(enabled) {
      try {
        await rm(managedRoot, { recursive: true, force: true })
        return {
          ok: true,
          root: managedRoot,
          copiedFrom: null,
          diagnostics: await report(enabled, true),
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          diagnostics: await report(enabled, true),
        }
      }
    },
  }
}

function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

function toolchainPathEntries(root: string): string[] {
  const manifest = readManifestSync(root)
  if (manifest) return manifestPathEntries(root, manifest)
  return [join(root, 'node'), join(root, 'python'), join(root, 'python', 'Scripts')]
}

type DesktopRuntimeManifest = {
  node?: {
    version?: string
    pathEntry?: string
  }
  python?: {
    version?: string
    pathEntry?: string
    scriptsPathEntry?: string
  }
}

function readManifestSync(root: string): DesktopRuntimeManifest | null {
  try {
    return JSON.parse(
      readFileSync(join(root, MANIFEST_NAME), 'utf8'),
    ) as DesktopRuntimeManifest
  } catch {
    return null
  }
}

async function readManifest(root: string | null): Promise<DesktopRuntimeManifest | null> {
  if (!root) return null
  try {
    return JSON.parse(await readFile(join(root, MANIFEST_NAME), 'utf8')) as DesktopRuntimeManifest
  } catch {
    return null
  }
}

function manifestPathEntries(
  root: string,
  manifest: DesktopRuntimeManifest,
): string[] {
  return [
    manifest.node?.pathEntry,
    manifest.python?.pathEntry,
    manifest.python?.scriptsPathEntry,
  ].flatMap(entry => (entry ? [join(root, entry)] : []))
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function inspectBinary(
  name: DesktopRuntimeBinaryName,
  pathEntries: string[],
  toolchainSource: DesktopRuntimeBinaryStatus['source'],
  env: Record<string, string | undefined>,
  includeVersion: boolean,
  targetVersion: string | undefined,
): Promise<DesktopRuntimeBinaryStatus> {
  const bundledPath = await findBinaryInPaths(name, pathEntries)
  if (bundledPath) {
    return binaryStatus(
      name,
      toolchainSource,
      bundledPath,
      includeVersion,
      targetVersion,
    )
  }

  const systemPath = await findSystemBinary(name, env)
  if (systemPath) {
    return binaryStatus(name, 'system', systemPath, includeVersion, targetVersion)
  }

  return {
    name,
    source: 'missing',
    path: null,
    exists: false,
    targetVersion,
    version: null,
  }
}

async function findBinaryInPaths(
  name: DesktopRuntimeBinaryName,
  paths: string[],
): Promise<string | null> {
  for (const dir of paths) {
    for (const candidateName of executableNames(name)) {
      const candidate = join(dir, candidateName)
      if (await fileExists(candidate)) return candidate
    }
  }
  return null
}

async function findSystemBinary(
  name: DesktopRuntimeBinaryName,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which'
    const { stdout } = await execFileAsync(command, [name], {
      env,
      timeout: 5_000,
      windowsHide: true,
    })
    return stdout.trim().split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

async function binaryStatus(
  name: DesktopRuntimeBinaryName,
  source: DesktopRuntimeBinaryStatus['source'],
  path: string,
  includeVersion: boolean,
  targetVersion: string | undefined,
): Promise<DesktopRuntimeBinaryStatus> {
  if (!includeVersion) {
    return { name, source, path, exists: true, targetVersion, version: null }
  }
  try {
    const { stdout, stderr } = await execFileAsync(path, ['--version'], {
      timeout: 5_000,
      windowsHide: true,
    })
    return {
      name,
      source,
      path,
      exists: true,
      targetVersion,
      version: (stdout || stderr).trim().split(/\r?\n/)[0] || null,
    }
  } catch (error) {
    return {
      name,
      source,
      path,
      exists: true,
      targetVersion,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function targetVersionForBinary(
  name: DesktopRuntimeBinaryName,
  manifest: DesktopRuntimeManifest | null,
): string | undefined {
  if (name === 'node' || name === 'npm' || name === 'npx') {
    return manifest?.node?.version
  }
  if (name === 'python' || name === 'pip') {
    return manifest?.python?.version
  }
  return undefined
}

function executableNames(name: DesktopRuntimeBinaryName): string[] {
  if (process.platform !== 'win32') return [name]
  if (name === 'python') return ['python.exe']
  return [`${name}.exe`, `${name}.cmd`]
}

async function writeDiagnosticLog(
  userDataPath: string,
  report: DesktopToolchainDiagnosticReport,
): Promise<string> {
  const logPath = join(
    userDataPath,
    'logs',
    `desktop-toolchain-${Date.now()}.json`,
  )
  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(logPath, JSON.stringify(report, null, 2), 'utf8')
  return logPath
}
