import { existsSync, readdirSync, statSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import { join } from 'node:path'
import { CopilotClient } from '@github/copilot-sdk'
import type {
  DesktopCopilotAuthStatus,
  DesktopCopilotLoginStatus,
} from '../shared/types.js'

function listBunPackageDirs(scopePath: string): string[] {
  try {
    if (!existsSync(scopePath)) return []
    return readdirSync(scopePath)
      .filter(entry => entry.startsWith('@github+copilot@'))
      .sort()
  } catch {
    return []
  }
}

function buildCliCandidates(): string[] {
  const candidates: string[] = []
  const exe = process.platform === 'win32' ? 'copilot.exe' : 'copilot'

  const roots: string[] = []
  if (app && typeof app.getAppPath === 'function') {
    roots.push(app.getAppPath())
  }
  roots.push(process.cwd())

  for (const root of roots) {
    candidates.push(join(root, 'node_modules', '.bin', exe))
    candidates.push(join(root, 'node_modules', '.bin', 'copilot'))
    const bunScope = join(root, 'node_modules', '.bun')
    for (const pkg of listBunPackageDirs(bunScope)) {
      candidates.push(join(bunScope, pkg, 'node_modules', '.bin', exe))
      candidates.push(join(bunScope, pkg, 'node_modules', '.bin', 'copilot'))
    }
  }

  return Array.from(new Set(candidates))
}

function findCopilotCliPath(): string | null {
  for (const candidate of buildCliCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

let cachedClient: CopilotClient | null = null

async function getClient(): Promise<CopilotClient> {
  if (cachedClient) return cachedClient
  const client = new CopilotClient({
    useLoggedInUser: true,
    logLevel: 'error',
  })
  await client.start()
  cachedClient = client
  return client
}

export async function getCopilotAuthStatus(): Promise<DesktopCopilotAuthStatus> {
  try {
    const client = await getClient()
    const status = await client.getAuthStatus()
    return {
      authenticated: Boolean(status?.isAuthenticated),
      user: status?.login ?? null,
      method: status?.authType ?? null,
    }
  } catch (error) {
    return {
      authenticated: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const DEVICE_CODE_PATTERNS = [
  /enter code ([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  /device code[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/,
]

const VERIFICATION_URL_PATTERN = /(https:\/\/github\.com\/login\/device[^\s]*)/i

type LoginAttemptState =
  | 'idle'
  | 'starting'
  | 'awaiting_auth'
  | 'completed'
  | 'failed'

type LoginAttempt = {
  state: LoginAttemptState
  deviceCode: string | null
  verificationUrl: string | null
  startedAt: number
  finishedAt: number | null
  exitCode: number | null
  error: string | null
  child: ChildProcessWithoutNullStreams | null
}

let currentAttempt: LoginAttempt | null = null
let authClient: CopilotClient | null = null

function killCurrentAttempt(): void {
  if (currentAttempt?.child && !currentAttempt.child.killed) {
    try {
      currentAttempt.child.kill()
    } catch {
      // ignore
    }
  }
  currentAttempt = null
}

function parseDeviceCode(text: string): string | null {
  for (const pattern of DEVICE_CODE_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

function parseVerificationUrl(text: string): string | null {
  const match = text.match(VERIFICATION_URL_PATTERN)
  return match?.[1] ?? null
}

export async function startCopilotLogin(): Promise<DesktopCopilotLoginStatus> {
  if (currentAttempt && currentAttempt.state !== 'completed' && currentAttempt.state !== 'failed') {
    const auth = await getCopilotAuthStatus().catch(() => null)
    return {
      state: currentAttempt.state,
      deviceCode: currentAttempt.deviceCode,
      verificationUrl: currentAttempt.verificationUrl,
      error: currentAttempt.error,
      auth,
      elapsedMs: Date.now() - currentAttempt.startedAt,
    }
  }

  const cliPath = findCopilotCliPath()
  if (!cliPath) {
    return {
      state: 'failed',
      deviceCode: null,
      verificationUrl: null,
      error: '未找到 GitHub Copilot CLI。请在终端中运行 `bun install`。',
      auth: null,
      elapsedMs: 0,
    }
  }

  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(cliPath, ['login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      env: process.env,
    })
  } catch (error) {
    return {
      state: 'failed',
      deviceCode: null,
      verificationUrl: null,
      error: error instanceof Error ? error.message : String(error),
      auth: null,
      elapsedMs: 0,
    }
  }

  currentAttempt = {
    state: 'starting',
    deviceCode: null,
    verificationUrl: null,
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    error: null,
    child,
  }

  let stdoutBuffer = ''
  let stderrBuffer = ''

  const handleChunk = (chunk: Buffer, target: 'stdout' | 'stderr') => {
    const text = chunk.toString()
    if (target === 'stdout') stdoutBuffer += text
    else stderrBuffer += text
    if (!currentAttempt) return
    const combined = stdoutBuffer + stderrBuffer
    if (!currentAttempt.deviceCode) {
      const code = parseDeviceCode(combined)
      if (code) currentAttempt.deviceCode = code
    }
    if (!currentAttempt.verificationUrl) {
      const url = parseVerificationUrl(combined)
      if (url) currentAttempt.verificationUrl = url
    }
    if (currentAttempt.deviceCode && currentAttempt.state === 'starting') {
      currentAttempt.state = 'awaiting_auth'
    }
  }

  child.stdout.on('data', (chunk: Buffer) => handleChunk(chunk, 'stdout'))
  child.stderr.on('data', (chunk: Buffer) => handleChunk(chunk, 'stderr'))

  child.on('error', error => {
    if (!currentAttempt) return
    currentAttempt.error = error.message
    currentAttempt.state = 'failed'
    currentAttempt.finishedAt = Date.now()
  })

  child.on('exit', code => {
    if (!currentAttempt) return
    currentAttempt.exitCode = code
    currentAttempt.finishedAt = Date.now()
    if (code === 0) {
      currentAttempt.state = 'completed'
    } else {
      const combined = stdoutBuffer + stderrBuffer
      currentAttempt.error =
        currentAttempt.error ??
        (combined.trim().length > 0
          ? combined.trim().split('\n').slice(-3).join('\n')
          : `copilot login exited with code ${code}`)
      currentAttempt.state = 'failed'
    }
  })

  return {
    state: currentAttempt.state,
    deviceCode: currentAttempt.deviceCode,
    verificationUrl: currentAttempt.verificationUrl,
    error: currentAttempt.error,
    auth: null,
    elapsedMs: Date.now() - currentAttempt.startedAt,
  }
}

export async function pollCopilotLogin(): Promise<DesktopCopilotLoginStatus> {
  if (!currentAttempt) {
    const auth = await getCopilotAuthStatus().catch(() => null)
    return {
      state: 'idle',
      deviceCode: null,
      verificationUrl: null,
      error: null,
      auth,
      elapsedMs: 0,
    }
  }

  const elapsedMs = (currentAttempt.finishedAt ?? Date.now()) - currentAttempt.startedAt
  let auth: DesktopCopilotAuthStatus | null = null
  if (currentAttempt.state === 'completed') {
    auth = await getCopilotAuthStatus().catch(() => null)
    if (auth?.authenticated) {
      // Reset cache so next call uses fresh token
      if (authClient) {
        try {
          await authClient.stop()
        } catch {
          // ignore
        }
        authClient = null
        cachedClient = null
      }
    }
  }

  return {
    state: currentAttempt.state,
    deviceCode: currentAttempt.deviceCode,
    verificationUrl: currentAttempt.verificationUrl,
    error: currentAttempt.error,
    auth,
    elapsedMs,
  }
}

export async function cancelCopilotLogin(): Promise<{ cancelled: boolean }> {
  if (!currentAttempt) return { cancelled: false }
  killCurrentAttempt()
  currentAttempt = null
  return { cancelled: true }
}

export function getCopilotLoginCommand(): string {
  const cliPath = findCopilotCliPath()
  if (!cliPath) return 'copilot login'
  return `"${cliPath}" login`
}

export async function stopCopilotAuthClient(): Promise<void> {
  if (cachedClient) {
    try {
      await cachedClient.stop()
    } catch {
      // best-effort
    }
    cachedClient = null
  }
  if (authClient) {
    try {
      await authClient.stop()
    } catch {
      // best-effort
    }
    authClient = null
  }
  killCurrentAttempt()
}
