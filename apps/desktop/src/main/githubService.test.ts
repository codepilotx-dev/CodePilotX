import { afterAll, expect, mock, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const calls: Array<[string, unknown[]]> = []
let cloneDialog = { canceled: true, filePaths: [] as string[] }
const fakeService = {
  readStatus: async (...args: unknown[]) => { calls.push(['readStatus', args]); return { authenticated: true, user: { login: 'octo', name: 'Octo', avatar_url: null }, error: null } },
  startLogin: async (...args: unknown[]) => { calls.push(['startLogin', args]); return { device_code: 'secret-device', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 60, interval: 5 } },
  pollLogin: async (...args: unknown[]) => { calls.push(['pollLogin', args]); return { status: 'completed' as const, auth: { authenticated: true, user: { login: 'octo' }, error: null } } },
  exchangeAppToken: async (...args: unknown[]) => { calls.push(['exchangeAppToken', args]); return { authenticated: true, expiresAt: 1, scopes: [], account: null } },
  refreshAppToken: async () => ({ authenticated: true, expiresAt: 1, scopes: [], account: null }),
  readAppTokenStatus: async () => ({ authenticated: true, expiresAt: 1, scopes: [], account: null }),
  cancelLogin: async (...args: unknown[]) => { calls.push(['cancelLogin', args]) },
  logout: async (...args: unknown[]) => { calls.push(['logout', args]) },
  logoutAppToken: async (...args: unknown[]) => { calls.push(['logoutAppToken', args]) },
  listRepositories: async (...args: unknown[]) => { calls.push(['listRepositories', args]); return [{ id: 42, name: 'repo', fullName: 'octo/repo', description: null, private: false, fork: true, archived: true, disabled: false, htmlUrl: 'https://github.com/octo/repo', cloneUrl: 'https://github.com/octo/repo.git', sshUrl: 'git@github.com:octo/repo.git', defaultBranch: 'main', language: 'Rust', stargazersCount: 7, updatedAt: '2026-01-01', pushedAt: '2026-01-02' }] },
  readProfile: async (...args: unknown[]) => { calls.push(['readProfile', args]); return { user: { login: 'octo', id: 1 } } },
  setStatus: async (...args: unknown[]) => { calls.push(['setStatus', args]); return null },
  clearStatus: async (...args: unknown[]) => { calls.push(['clearStatus', args]); return null },
  cloneRepository: async (...args: unknown[]) => { calls.push(['cloneRepository', args]); return process.cwd() },
}

mock.module('electron', () => ({
  app: { getPath: () => 'C:\\temp', isPackaged: false },
  shell: { openExternal: async () => {} },
  dialog: { showOpenDialog: async () => cloneDialog },
  safeStorage: {},
}))

const service = await import('./githubService.js')
service.configureGithubService({
  getWindow: () => null,
  authService: fakeService as unknown as Parameters<typeof service.configureGithubService>[0]['authService'],
  finalizeClone: async path => ({ path, name: 'repo', isGitRepository: true }) as never,
})

test('GitHub desktop API delegates login and app-token exchange to Rust', async () => {
  calls.length = 0
  expect((await service.startGithubLogin({ clientId: 'client' })).state).toBe('awaiting_auth')
  expect((await service.pollGithubLogin()).state).toBe('completed')
  expect(calls.map(([name]) => name)).toEqual(['startLogin', 'pollLogin', 'exchangeAppToken'])
  expect(JSON.stringify(calls)).not.toContain('secret-device')
})

test('GitHub desktop API delegates auth, repositories, profile and status to Rust', async () => {
  calls.length = 0
  expect((await service.getGithubAuthStatus()).user?.login).toBe('octo')
  const repos = await service.listGithubRepositories()
  expect(repos).toEqual({ ok: true, repositories: [{ id: 42, name: 'repo', fullName: 'octo/repo', owner: 'octo', private: false, fork: true, archived: true, disabled: false, cloneUrl: 'https://github.com/octo/repo.git', sshUrl: 'git@github.com:octo/repo.git', htmlUrl: 'https://github.com/octo/repo', description: null, defaultBranch: 'main', pushedAt: '2026-01-02', updatedAt: '2026-01-01' }] })
  expect((await service.getGithubProfileOverview()).ok).toBe(true)
  await service.setGithubUserStatus({ emoji: ':wave:', message: 'hi', limitedAvailability: false })
  await service.clearGithubUserStatus()
  await service.logoutGithub()
  expect(calls.map(([name]) => name)).toEqual(['readStatus', 'listRepositories', 'readProfile', 'setStatus', 'clearStatus', 'logout', 'readStatus'])
})

test('application logout clears only the Rust app token', async () => {
  calls.length = 0
  await service.logoutAppAuth()
  expect(calls).toEqual([['logoutAppToken', ['github-repositories']]])
})

test('clone passes the selected target and repository URL to Rust', async () => {
  calls.length = 0
  cloneDialog = { canceled: false, filePaths: [process.cwd()] }
  const repo = (await service.listGithubRepositories())
  if (!repo.ok) throw new Error('repository fixture failed')
  await service.cloneGithubRepository({ repository: repo.repositories[0]! })
  expect(calls.find(([name]) => name === 'cloneRepository')).toEqual([
    'cloneRepository',
    ['github-repositories', 'https://github.com/octo/repo.git', expect.stringContaining('repo')],
  ])
  cloneDialog = { canceled: true, filePaths: [] }
})

test('GitHub service source has no token, network, credential-file or git-process implementation', async () => {
  const source = await readFile(new URL('./githubService.ts', import.meta.url), 'utf8')
  for (const forbidden of ['safeStorage', 'execFile', '.credentials.json', 'exchangeGithubToken', 'fetch(']) {
    expect(source).not.toContain(forbidden)
  }
})

afterAll(() => mock.restore())
