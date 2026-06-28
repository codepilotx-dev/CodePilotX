import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
}

const CODEX_NPM_NAME = '@openai/codex'
const CODEX_PACKAGE_ROOT_ENV = 'CODEX_MANAGED_PACKAGE_ROOT'

const moduleRequire = createRequire(import.meta.url)

export type CodexPathResolution = {
  executablePath: string
  packageRoot: string
  pathDirs: string[]
}

export function findCodexBinary(
  override: string | null = null,
): CodexPathResolution {
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`Codex binary not found at ${override}`)
    }
    return {
      executablePath: override,
      packageRoot: path.dirname(override),
      pathDirs: [],
    }
  }
  const { platform, arch } = process
  let targetTriple: string | null = null
  switch (platform) {
    case 'linux':
    case 'android':
      switch (arch) {
        case 'x64':
          targetTriple = 'x86_64-unknown-linux-musl'
          break
        case 'arm64':
          targetTriple = 'aarch64-unknown-linux-musl'
          break
      }
      break
    case 'darwin':
      switch (arch) {
        case 'x64':
          targetTriple = 'x86_64-apple-darwin'
          break
        case 'arm64':
          targetTriple = 'aarch64-apple-darwin'
          break
      }
      break
    case 'win32':
      switch (arch) {
        case 'x64':
          targetTriple = 'x86_64-pc-windows-msvc'
          break
        case 'arm64':
          targetTriple = 'aarch64-pc-windows-msvc'
          break
      }
      break
  }
  if (!targetTriple) {
    throw new Error(`Unsupported platform: ${platform} (${arch})`)
  }
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple]
  if (!platformPackage) {
    throw new Error(`Unsupported target triple: ${targetTriple}`)
  }

  let vendorRoot: string | null = null
  for (const requireFrom of moduleResolutionRoots()) {
    try {
      const packageJsonPath = requireFrom.resolve(
        `${platformPackage}/package.json`,
      )
      vendorRoot = path.join(path.dirname(packageJsonPath), 'vendor')
      break
    } catch {
      // try next resolution root
    }
  }
  if (!vendorRoot) {
    const fallback = process.env[CODEX_PACKAGE_ROOT_ENV]
    if (fallback) {
      vendorRoot = path.join(fallback, 'vendor')
    }
  }
  if (!vendorRoot) {
    throw new Error(
      `Unable to locate Codex CLI binaries. Ensure ${CODEX_NPM_NAME} is installed with optional dependencies.`,
    )
  }

  const codexBinaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const packageRoot = path.join(vendorRoot, targetTriple)
  const packageBinaryPath = path.join(packageRoot, 'bin', codexBinaryName)
  if (
    existsSync(packageBinaryPath) &&
    existsSync(path.join(packageRoot, 'codex-package.json'))
  ) {
    return {
      executablePath: packageBinaryPath,
      packageRoot,
      pathDirs: existingDirs(path.join(packageRoot, 'codex-path')),
    }
  }
  const legacyBinaryPath = path.join(packageRoot, 'codex', codexBinaryName)
  if (existsSync(legacyBinaryPath)) {
    return {
      executablePath: legacyBinaryPath,
      packageRoot,
      pathDirs: existingDirs(path.join(packageRoot, 'path')),
    }
  }
  throw new Error(
    `Unable to locate Codex CLI binaries for ${targetTriple}. Ensure ${CODEX_NPM_NAME} is installed with optional dependencies.`,
  )
}

export function buildAppServerArgs(options: {
  transport:
    | 'stdio'
    | { type: 'stdio' }
    | { type: 'unix'; socketPath: string }
}): string[] {
  if (
    options.transport === 'stdio' ||
    options.transport.type === 'stdio'
  ) {
    return ['app-server', '--stdio']
  }
  return ['app-server', '--listen', `unix://${options.transport.socketPath}`]
}

export function spawnCodex(
  executablePath: string,
  args: string[],
  env: Record<string, string>,
): ChildProcessWithoutNullStreams {
  const child = spawn(executablePath, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (!child.stdin || !child.stdout || !child.stderr) {
    child.kill()
    throw new Error('Codex app-server process is missing required stdio pipes.')
  }
  return child
}

function existingDirs(...dirs: string[]): string[] {
  return dirs.filter(dir => {
    try {
      return statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

function moduleResolutionRoots(): NodeRequire[] {
  const roots = [moduleRequire]
  const candidatePackageJsonPaths = [
    path.join(process.cwd(), 'package.json'),
    path.join(process.cwd(), 'apps', 'desktop', 'package.json'),
  ]
  for (const packageJsonPath of candidatePackageJsonPaths) {
    if (!existsSync(packageJsonPath)) continue
    try {
      roots.push(createRequire(packageJsonPath))
    } catch {
      // ignore invalid candidate
    }
  }
  return roots
}
