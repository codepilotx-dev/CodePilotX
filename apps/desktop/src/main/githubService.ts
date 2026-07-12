import { dialog, shell, type BrowserWindow } from 'electron'
import { basename, resolve } from 'node:path'
import type {
  CloneGithubRepositoryInput,
  DesktopGithubAuthStatus,
  DesktopGithubCloneResult,
  DesktopGithubLoginStatus,
  DesktopGithubProfileOverviewResult,
  DesktopGithubRepository,
  DesktopGithubRepositoryListResult,
  DesktopGithubUserStatusInput,
  DesktopGithubUserStatusResult,
  DesktopWorkspace,
  StartGithubLoginInput,
} from '../shared/types.js'
import { readDesktopStoredSettings } from './desktopSettings.js'
import { registerAllowedWorkspace, workspaceFromPath } from './workspaceService.js'
import {
  getRustAppServerAuthService,
  type RustAppServerAuthService,
  type ProviderAuthStatus,
  type ProviderRepoInfo,
} from './rustAppServerAuthService.js'

const PROVIDER_ID = 'github-repositories'
type GithubAuthService = Pick<RustAppServerAuthService,
  'readStatus' | 'startLogin' | 'pollLogin' | 'cancelLogin' | 'logout' |
  'listRepositories' | 'cloneRepository' | 'exchangeAppToken' |
  'refreshAppToken' | 'readAppTokenStatus' | 'logoutAppToken' | 'readProfile' | 'setStatus' |
  'clearStatus'>

let authServiceOverride: GithubAuthService | undefined
const getAuthService = (): GithubAuthService =>
  authServiceOverride ?? getRustAppServerAuthService()
let getDialogWindow: () => BrowserWindow | null = () => null
let finalizeClone: (path: string) => Promise<DesktopWorkspace> = async path => {
  registerAllowedWorkspace(path)
  return workspaceFromPath(path)
}
let startedAt = 0
let expiresAt: number | null = null

export function configureGithubService(options: {
  getWindow: () => BrowserWindow | null
  authService?: GithubAuthService
  finalizeClone?: (path: string) => Promise<DesktopWorkspace>
}): void {
  getDialogWindow = options.getWindow
  if (options.authService) authServiceOverride = options.authService
  if (options.finalizeClone) finalizeClone = options.finalizeClone
}

export async function getGithubAuthStatus(): Promise<DesktopGithubAuthStatus> {
  try {
    return mapAuth(await getAuthService().readStatus(PROVIDER_ID))
  } catch (error) {
    return { configured: true, authenticated: false, user: null, error: errorMessageOf(error) }
  }
}

export async function startGithubLogin(input?: StartGithubLoginInput): Promise<DesktopGithubLoginStatus> {
  const clientId = await getGithubClientId(input?.clientId)
  if (!clientId) return failedLoginStatus('未配置 GitHub OAuth Client ID。')
  try {
    const response = await getAuthService().startLogin(PROVIDER_ID, clientId)
    startedAt = Date.now()
    expiresAt = startedAt + response.expires_in * 1000
    await shell.openExternal(response.verification_uri)
    return {
      state: 'awaiting_auth', userCode: response.user_code,
      verificationUri: response.verification_uri,
      expiresAt: new Date(expiresAt).toISOString(), error: null, auth: null, elapsedMs: 0,
    }
  } catch (error) { return failedLoginStatus(errorMessageOf(error)) }
}

export async function pollGithubLogin(): Promise<DesktopGithubLoginStatus> {
  try {
    const response = await getAuthService().pollLogin(PROVIDER_ID)
    const state = response.status === 'completed' ? 'completed'
      : response.status === 'pending' ? 'awaiting_auth' : 'failed'
    const auth = response.auth ? mapAuth(response.auth) : null
    if (response.status === 'completed') await getAuthService().exchangeAppToken(PROVIDER_ID)
    return { state, userCode: null, verificationUri: null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      error: response.status === 'expired' ? 'GitHub 授权码已过期，请重新登录。'
        : response.status === 'denied' ? 'GitHub 登录已取消。' : null,
      auth, elapsedMs: startedAt ? Date.now() - startedAt : 0 }
  } catch (error) { return failedLoginStatus(errorMessageOf(error)) }
}

export async function cancelGithubLogin(): Promise<DesktopGithubLoginStatus> {
  await getAuthService().cancelLogin(PROVIDER_ID)
  return { state: 'idle', userCode: null, verificationUri: null, expiresAt: null,
    error: null, auth: await getGithubAuthStatus(), elapsedMs: 0 }
}

export async function logoutGithub(): Promise<DesktopGithubAuthStatus> {
  await getAuthService().logout(PROVIDER_ID)
  return getGithubAuthStatus()
}

export async function logoutAppAuth(): Promise<void> {
  await getAuthService().logoutAppToken(PROVIDER_ID)
}

export async function listGithubRepositories(): Promise<DesktopGithubRepositoryListResult> {
  try { return { ok: true, repositories: (await getAuthService().listRepositories(PROVIDER_ID)).map(mapRepo) } }
  catch (error) { return { ok: false, error: errorMessageOf(error) } }
}

export async function getGithubProfileOverview(): Promise<DesktopGithubProfileOverviewResult> {
  try { return { ok: true, overview: await getAuthService().readProfile(PROVIDER_ID) } }
  catch (error) { return { ok: false, error: errorMessageOf(error) } }
}

export async function setGithubUserStatus(input: DesktopGithubUserStatusInput): Promise<DesktopGithubUserStatusResult> {
  try { return { ok: true, status: await getAuthService().setStatus(PROVIDER_ID, input) } }
  catch (error) { return { ok: false, error: errorMessageOf(error) } }
}

export async function clearGithubUserStatus(): Promise<DesktopGithubUserStatusResult> {
  try { return { ok: true, status: await getAuthService().clearStatus(PROVIDER_ID) } }
  catch (error) { return { ok: false, error: errorMessageOf(error) } }
}

export async function cloneGithubRepository(input: CloneGithubRepositoryInput): Promise<DesktopGithubCloneResult> {
  try {
    const parent = await chooseCloneParentDirectory()
    if (!parent) return { ok: false, error: '已取消选择克隆目录。' }
    const target = await resolveCloneTargetPath(parent, input.repository.name)
    const localPath = await getAuthService().cloneRepository(PROVIDER_ID, input.repository.cloneUrl, target)
    return { ok: true, workspace: await finalizeClone(localPath) }
  } catch (error) { return { ok: false, error: errorMessageOf(error) } }
}

function mapAuth(status: ProviderAuthStatus): DesktopGithubAuthStatus {
  return { configured: true, authenticated: status.authenticated,
    user: status.user ? { login: status.user.login, id: status.user.id, name: status.user.name,
      avatarUrl: status.user.avatarUrl, htmlUrl: status.user.htmlUrl } : null,
    ...(status.error ? { error: status.error } : {}) }
}

function mapRepo(repo: ProviderRepoInfo): DesktopGithubRepository {
  return { id: repo.id, name: repo.name, fullName: repo.fullName,
    owner: repo.fullName.split('/')[0] ?? '', private: repo.private, fork: repo.fork,
    archived: repo.archived, disabled: repo.disabled, cloneUrl: repo.cloneUrl,
    sshUrl: repo.sshUrl, htmlUrl: repo.htmlUrl, description: repo.description,
    defaultBranch: repo.defaultBranch, pushedAt: repo.pushedAt, updatedAt: repo.updatedAt }
}

async function getGithubClientId(preferred?: string): Promise<string> {
  if (preferred?.trim()) return preferred.trim()
  const settings = await readDesktopStoredSettings().catch(() => null)
  return (settings?.githubOAuthClientId ?? process.env.CODEPILOTX_GITHUB_OAUTH_CLIENT_ID ?? '').trim()
}

async function chooseCloneParentDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog(getDialogWindow() ?? undefined, {
    title: '选择 GitHub 仓库克隆位置', properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled || !result.filePaths[0] ? null : resolve(result.filePaths[0])
}

async function resolveCloneTargetPath(parent: string, repoName: string): Promise<string> {
  const safeName = basename(repoName).trim()
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('Repository name is not valid for a local folder.')
  return resolve(parent, safeName)
}

function failedLoginStatus(error: string): DesktopGithubLoginStatus {
  return { state: 'failed', userCode: null, verificationUri: null, expiresAt: null,
    error, auth: null, elapsedMs: startedAt ? Date.now() - startedAt : 0 }
}

function errorMessageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
