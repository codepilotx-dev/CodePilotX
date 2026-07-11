import { afterAll, expect, mock, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const calls: Array<[string, unknown[]]> = []
const fakeService = {
  readStatus: async (...args: unknown[]) => { calls.push(['readStatus', args]); return { authenticated: true, user: { login: 'octo', name: 'Octo', avatar_url: null }, error: null } },
  startLogin: async (...args: unknown[]) => { calls.push(['startLogin', args]); return { device_code: 'secret-device', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 60, interval: 5 } },
  pollLogin: async (...args: unknown[]) => { calls.push(['pollLogin', args]); return { status: 'completed' as const, auth: { authenticated: true, user: { login: 'octo' }, error: null } } },
  exchangeAppToken: async (...args: unknown[]) => { calls.push(['exchangeAppToken', args]); return { authenticated: true, expiresAt: 1, scopes: [], account: null } },
  refreshAppToken: async () => ({ authenticated: true, expiresAt: 1, scopes: [], account: null }),
  readAppTokenStatus: async () => ({ authenticated: true, expiresAt: 1, scopes: [], account: null }),
  cancelLogin: async (...args: unknown[]) => { calls.push(['cancelLogin', args]) },
  logout: async (...args: unknown[]) => { calls.push(['logout', args]) },
  listRepositories: async (...args: unknown[]) => { calls.push(['listRepositories', args]); return [{ name: 'repo', full_name: 'octo/repo', description: null, private: false, html_url: 'https://github.com/octo/repo', clone_url: 'https://github.com/octo/repo.git', default_branch: 'main' }] },
  readProfile: async (...args: unknown[]) => { calls.push(['readProfile', args]); return { user: { login: 'octo', id: 1 } } },
  setStatus: async (...args: unknown[]) => { calls.push(['setStatus', args]); return null },
  clearStatus: async (...args: unknown[]) => { calls.push(['clearStatus', args]); return null },
  cloneRepository: async (...args: unknown[]) => { calls.push(['cloneRepository', args]); return 'C:\\work\\repo' },
}

mock.module('electron', () => ({
  app: { getPath: () => 'C:\\temp', isPackaged: false },
  shell: { openExternal: async () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  safeStorage: {},
}))

const service = await import('./githubService.js')
service.configureGithubService({
  getWindow: () => null,
  authService: fakeService as unknown as Parameters<typeof service.configureGithubService>[0]['authService'],
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
  expect((await service.listGithubRepositories()).ok).toBe(true)
  expect((await service.getGithubProfileOverview()).ok).toBe(true)
  await service.setGithubUserStatus({ emoji: ':wave:', message: 'hi', limitedAvailability: false })
  await service.clearGithubUserStatus()
  await service.logoutGithub()
  expect(calls.map(([name]) => name)).toEqual(['readStatus', 'listRepositories', 'readProfile', 'setStatus', 'clearStatus', 'logout', 'readStatus'])
})

test('GitHub service source has no token, network, credential-file or git-process implementation', async () => {
  const source = await readFile(new URL('./githubService.ts', import.meta.url), 'utf8')
  for (const forbidden of ['safeStorage', 'execFile', '.credentials.json', 'exchangeGithubToken', 'fetch(']) {
    expect(source).not.toContain(forbidden)
  }
})

afterAll(() => mock.restore())
