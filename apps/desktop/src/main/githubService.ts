import { app, dialog, safeStorage, shell, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  CloneGithubRepositoryInput,
  DesktopGithubAuthStatus,
  DesktopGithubCloneResult,
  DesktopGithubLoginStatus,
  DesktopGithubRepository,
  DesktopGithubRepositoryListResult,
  DesktopGithubUser,
  StartGithubLoginInput,
} from '../shared/types.js'
import { readDesktopStoredSettings } from './desktopSettings.js'
import {
  registerAllowedWorkspace,
  workspaceFromPath,
} from './workspaceService.js'

const execFileAsync = promisify(execFile)
const GITHUB_API_VERSION = '2022-11-28'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_API_URL = 'https://api.github.com'
const AUTH_STORAGE_FILE = 'github-auth.json'
const OAUTH_SCOPE = 'repo read:user'

type StoredGithubAuth = {
  login: string
  user: DesktopGithubUser
  token: StoredGithubToken
  storedAt: string
}

type StoredGithubToken =
  | { kind: 'safeStorage'; value: string }
  | { kind: 'plain'; value: string }

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type TokenResponse =
  | { access_token: string; token_type: string; scope: string }
  | { error: string; error_description?: string }

type GithubLoginAttempt = {
  state: DesktopGithubLoginStatus['state']
  clientId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalMs: number
  startedAt: number
  nextPollAt: number
  error: string | null
  auth: DesktopGithubAuthStatus | null
}

let currentAttempt: GithubLoginAttempt | null = null
let getDialogWindow: () => BrowserWindow | null = () => null

export function configureGithubService(options: {
  getWindow: () => BrowserWindow | null
}): void {
  getDialogWindow = options.getWindow
}

export async function getGithubAuthStatus(): Promise<DesktopGithubAuthStatus> {
  if (!(await getGithubClientId())) {
    return {
      configured: false,
      authenticated: false,
      user: null,
      error: '未配置 GitHub OAuth Client ID。',
    }
  }

  const token = await readGithubToken()
  if (!token) {
    return { configured: true, authenticated: false, user: null }
  }

  try {
    const user = await fetchGithubUser(token)
    await storeGithubAuth(token, user)
    return { configured: true, authenticated: true, user }
  } catch (error) {
    return {
      configured: true,
      authenticated: false,
      user: null,
      error: errorMessageOf(error),
    }
  }
}

export async function startGithubLogin(
  input?: StartGithubLoginInput,
): Promise<DesktopGithubLoginStatus> {
  if (currentAttempt && isAttemptActive(currentAttempt)) {
    return statusFromAttempt(currentAttempt)
  }

  const clientId = await getGithubClientId(input?.clientId)
  if (!clientId) {
    return failedLoginStatus('未配置 GitHub OAuth Client ID。')
  }

  try {
    const device = await requestDeviceCode(clientId)
    currentAttempt = {
      state: 'awaiting_auth',
      clientId,
      deviceCode: device.device_code,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresAt: Date.now() + device.expires_in * 1000,
      intervalMs: Math.max(device.interval, 1) * 1000,
      startedAt: Date.now(),
      nextPollAt: Date.now(),
      error: null,
      auth: null,
    }
    await shell.openExternal(device.verification_uri)
    return statusFromAttempt(currentAttempt)
  } catch (error) {
    return failedLoginStatus(errorMessageOf(error))
  }
}

export async function pollGithubLogin(): Promise<DesktopGithubLoginStatus> {
  if (!currentAttempt) {
    return {
      state: 'idle',
      userCode: null,
      verificationUri: null,
      expiresAt: null,
      error: null,
      auth: await getGithubAuthStatus().catch(() => null),
      elapsedMs: 0,
    }
  }

  if (!isAttemptActive(currentAttempt)) {
    return statusFromAttempt(currentAttempt)
  }

  if (Date.now() < currentAttempt.nextPollAt) {
    return statusFromAttempt(currentAttempt)
  }

  const clientId = currentAttempt.clientId || (await getGithubClientId())
  if (!clientId) {
    currentAttempt.state = 'failed'
    currentAttempt.error = '未配置 GitHub OAuth Client ID。'
    return statusFromAttempt(currentAttempt)
  }

  try {
    currentAttempt.nextPollAt = Date.now() + currentAttempt.intervalMs
    const tokenResponse = await pollAccessToken(
      clientId,
      currentAttempt.deviceCode,
    )
    if ('access_token' in tokenResponse) {
      const user = await fetchGithubUser(tokenResponse.access_token)
      await storeGithubAuth(tokenResponse.access_token, user)
      currentAttempt.state = 'completed'
      currentAttempt.auth = { configured: true, authenticated: true, user }
      return statusFromAttempt(currentAttempt)
    }

    switch (tokenResponse.error) {
      case 'authorization_pending':
        return statusFromAttempt(currentAttempt)
      case 'slow_down':
        currentAttempt.intervalMs += 5000
        currentAttempt.nextPollAt = Date.now() + currentAttempt.intervalMs
        return statusFromAttempt(currentAttempt)
      case 'expired_token':
        currentAttempt.state = 'failed'
        currentAttempt.error = 'GitHub 授权码已过期，请重新登录。'
        return statusFromAttempt(currentAttempt)
      case 'access_denied':
        currentAttempt.state = 'failed'
        currentAttempt.error = 'GitHub 登录已取消。'
        return statusFromAttempt(currentAttempt)
      default:
        currentAttempt.state = 'failed'
        currentAttempt.error =
          tokenResponse.error_description ?? tokenResponse.error
        return statusFromAttempt(currentAttempt)
    }
  } catch (error) {
    currentAttempt.state = 'failed'
    currentAttempt.error = errorMessageOf(error)
    return statusFromAttempt(currentAttempt)
  }
}

export async function logoutGithub(): Promise<DesktopGithubAuthStatus> {
  currentAttempt = null
  await rm(authStoragePath(), { force: true })
  return getGithubAuthStatus()
}

export async function listGithubRepositories(): Promise<DesktopGithubRepositoryListResult> {
  try {
    const token = await requireGithubToken()
    const repositories: DesktopGithubRepository[] = []
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(
        `${GITHUB_API_URL}/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc&per_page=100&page=${page}`,
        { headers: githubApiHeaders(token) },
      )
      if (!response.ok) {
        throw new Error(await githubErrorMessage(response))
      }
      const pageItems = await response.json()
      if (!Array.isArray(pageItems)) {
        throw new Error('GitHub repositories response was not an array.')
      }
      repositories.push(...pageItems.map(normalizeRepository))
      if (pageItems.length < 100) {
        break
      }
    }
    return { ok: true, repositories }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

export async function cloneGithubRepository(
  input: CloneGithubRepositoryInput,
): Promise<DesktopGithubCloneResult> {
  try {
    const token = await requireGithubToken()
    const repository = input.repository
    if (!isGithubCloneUrl(repository.cloneUrl)) {
      throw new Error('Only github.com HTTPS clone URLs are supported.')
    }

    await assertCommandAvailable(
      'git',
      'Git is required to clone GitHub repositories.',
    )

    const parentDirectory = await chooseCloneParentDirectory()
    if (!parentDirectory) {
      return { ok: false, error: '已取消选择克隆目录。' }
    }

    const targetPath = await resolveCloneTargetPath(
      parentDirectory,
      repository.name,
    )
    try {
      await cloneWithGithubToken(repository.cloneUrl, targetPath, token)
    } catch (error) {
      await rm(targetPath, { recursive: true, force: true }).catch(() => {})
      throw new Error(sanitizeGitError(error))
    }

    registerAllowedWorkspace(targetPath)
    return { ok: true, workspace: await workspaceFromPath(targetPath) }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

async function getGithubClientId(preferredClientId?: string): Promise<string> {
  if (preferredClientId?.trim()) {
    return preferredClientId.trim()
  }
  const settingsClientId = await readDesktopStoredSettings()
    .then(settings => settings.githubOAuthClientId)
    .catch(() => '')
  const envClientId =
    process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID ??
    process.env.GITHUB_OAUTH_CLIENT_ID ??
    ''
  return (settingsClientId || envClientId).trim()
}

async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: clientId, scope: OAUTH_SCOPE }),
  })
  if (!response.ok) {
    throw new Error(await githubErrorMessage(response))
  }
  return (await response.json()) as DeviceCodeResponse
}

async function pollAccessToken(
  clientId: string,
  deviceCode: string,
): Promise<TokenResponse> {
  const response = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  if (!response.ok) {
    throw new Error(await githubErrorMessage(response))
  }
  return (await response.json()) as TokenResponse
}

async function fetchGithubUser(token: string): Promise<DesktopGithubUser> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: githubApiHeaders(token),
  })
  if (!response.ok) {
    throw new Error(await githubErrorMessage(response))
  }
  const data = (await response.json()) as Record<string, unknown>
  return {
    login: stringValue(data.login),
    id: numberValue(data.id),
    name: nullableStringValue(data.name),
    avatarUrl: nullableStringValue(data.avatar_url),
    htmlUrl: stringValue(data.html_url),
  }
}

function githubApiHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
}

async function githubErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: unknown }
    if (typeof data.message === 'string' && data.message.trim()) {
      return `GitHub API ${response.status}: ${data.message}`
    }
  } catch {
    // ignore parse errors
  }
  return `GitHub API ${response.status}: ${response.statusText}`
}

function normalizeRepository(value: unknown): DesktopGithubRepository {
  const data = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
  const owner = data.owner && typeof data.owner === 'object'
    ? (data.owner as Record<string, unknown>)
    : {}
  return {
    id: numberValue(data.id),
    name: stringValue(data.name),
    fullName: stringValue(data.full_name),
    owner: stringValue(owner.login),
    private: booleanValue(data.private),
    fork: booleanValue(data.fork),
    archived: booleanValue(data.archived),
    disabled: booleanValue(data.disabled),
    cloneUrl: stringValue(data.clone_url),
    sshUrl: stringValue(data.ssh_url),
    htmlUrl: stringValue(data.html_url),
    description: nullableStringValue(data.description),
    defaultBranch: stringValue(data.default_branch),
    pushedAt: nullableStringValue(data.pushed_at),
    updatedAt: nullableStringValue(data.updated_at),
  }
}

async function requireGithubToken(): Promise<string> {
  const token = await readGithubToken()
  if (!token) {
    throw new Error('请先登录 GitHub。')
  }
  return token
}

async function readGithubToken(): Promise<string | null> {
  try {
    const raw = await readFile(authStoragePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredGithubAuth>
    if (!parsed.token) return null
    return decryptToken(parsed.token)
  } catch {
    return null
  }
}

async function storeGithubAuth(
  token: string,
  user: DesktopGithubUser,
): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const stored: StoredGithubAuth = {
    login: user.login,
    user,
    token: encryptToken(token),
    storedAt: new Date().toISOString(),
  }
  await writeFile(authStoragePath(), JSON.stringify(stored, null, 2), 'utf8')
}

function encryptToken(token: string): StoredGithubToken {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      kind: 'safeStorage',
      value: safeStorage.encryptString(token).toString('base64'),
    }
  }
  return { kind: 'plain', value: token }
}

function decryptToken(token: StoredGithubToken): string | null {
  if (token.kind === 'plain') return token.value
  if (token.kind === 'safeStorage') {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(token.value, 'base64'))
  }
  return null
}

function authStoragePath(): string {
  return join(app.getPath('userData'), AUTH_STORAGE_FILE)
}

function statusFromAttempt(
  attempt: GithubLoginAttempt,
): DesktopGithubLoginStatus {
  return {
    state: attempt.state,
    userCode: attempt.userCode,
    verificationUri: attempt.verificationUri,
    expiresAt: new Date(attempt.expiresAt).toISOString(),
    error: attempt.error,
    auth: attempt.auth,
    elapsedMs: Date.now() - attempt.startedAt,
  }
}

function failedLoginStatus(error: string): DesktopGithubLoginStatus {
  return {
    state: 'failed',
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error,
    auth: null,
    elapsedMs: 0,
  }
}

function isAttemptActive(attempt: GithubLoginAttempt): boolean {
  if (attempt.state === 'completed' || attempt.state === 'failed') {
    return false
  }
  if (Date.now() > attempt.expiresAt) {
    attempt.state = 'failed'
    attempt.error = 'GitHub 授权码已过期，请重新登录。'
    return false
  }
  return true
}

async function chooseCloneParentDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog(getDialogWindow() ?? undefined, {
    title: '选择 GitHub 仓库克隆位置',
    properties: ['openDirectory', 'createDirectory'],
  })
  const selected = result.filePaths[0]
  if (result.canceled || !selected) {
    return null
  }
  return resolve(selected)
}

async function resolveCloneTargetPath(
  parentDirectory: string,
  repoName: string,
): Promise<string> {
  const safeName = basename(repoName).trim()
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Repository name is not valid for a local folder.')
  }
  const targetPath = resolve(parentDirectory, safeName)
  const relativeTarget = relative(resolve(parentDirectory), targetPath)
  if (
    relativeTarget === '' ||
    relativeTarget.startsWith('..') ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error('Clone target path escaped the selected directory.')
  }
  try {
    const targetStat = await stat(targetPath)
    if (!targetStat.isDirectory()) {
      throw new Error(`Clone target already exists and is not a directory: ${targetPath}`)
    }
    const entries = await readdir(targetPath)
    if (entries.length > 0) {
      throw new Error(`Clone target directory is not empty: ${targetPath}`)
    }
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return targetPath
    }
    throw error
  }
  return targetPath
}

function isGithubCloneUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
  } catch {
    return false
  }
}

async function cloneWithGithubToken(
  cloneUrl: string,
  targetPath: string,
  token: string,
): Promise<void> {
  const askPassDir = await mkdtemp(join(tmpdir(), 'codepilotx-github-'))
  const askPassPath = join(
    askPassDir,
    process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh',
  )
  const askPassContent =
    process.platform === 'win32'
      ? [
          '@echo off',
          'echo %* | findstr /I "Username" >nul',
          'if %errorlevel%==0 (',
          '  echo %GIT_USERNAME%',
          ') else (',
          '  echo %GIT_PASSWORD%',
          ')',
          '',
        ].join('\r\n')
      : [
          '#!/bin/sh',
          'case "$1" in',
          '*Username*) printf "%s\\n" "$GIT_USERNAME" ;;',
          '*) printf "%s\\n" "$GIT_PASSWORD" ;;',
          'esac',
          '',
        ].join('\n')

  try {
    await writeFile(askPassPath, askPassContent, 'utf8')
    if (process.platform !== 'win32') {
      await chmod(askPassPath, 0o700)
    }
    await execFileAsync('git', ['clone', '--', cloneUrl, targetPath], {
      env: {
        ...process.env,
        GIT_ASKPASS: askPassPath,
        GIT_TERMINAL_PROMPT: '0',
        GIT_USERNAME: 'x-access-token',
        GIT_PASSWORD: token,
      },
    })
  } finally {
    await rm(askPassDir, { recursive: true, force: true }).catch(() => {})
  }
}

function sanitizeGitError(error: unknown): string {
  const message = errorMessageOf(error)
  return message.replace(/x-access-token:[^@\s]+@github\.com/gi, 'x-access-token:***@github.com')
}

async function assertCommandAvailable(
  command: string,
  errorMessage: string,
): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('where.exe', [command])
      return
    }
    await execFileAsync('which', [command])
  } catch {
    throw new Error(errorMessage)
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
