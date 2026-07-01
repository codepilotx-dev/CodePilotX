import { expect, test } from 'bun:test'
import {
  getCodePilotXMcpConfigs,
  getMcpConfigsByScope,
} from './config.js'
import { withMcpConfigRuntime } from './configRuntime.js'
import type {
  McpConfigRuntime,
  McpServerPolicyEntry,
} from './configRuntime.js'
import type { McpJsonConfig, McpServerConfig } from './types.js'

function createRuntime(
  overrides: Partial<McpConfigRuntime> = {},
): McpConfigRuntime {
  const files = new Map<string, McpJsonConfig>()
  const store = {
    getUserMcpServers: () => undefined,
    saveUserMcpServers: () => {},
    getLocalMcpServers: () => undefined,
    saveLocalMcpServers: () => {},
    readMcpJsonFile: (filePath: string) => files.get(filePath) ?? null,
    writeMcpJsonFile: async (config: McpJsonConfig, cwd: string) => {
      files.set(`${cwd}/.mcp.json`, config)
    },
    getEnterpriseMcpFilePath: () => '/managed/managed-mcp.json',
    getDisabledMcpServers: () => [],
    getEnabledMcpServers: () => [],
    saveDisabledMcpServers: () => {},
    saveEnabledMcpServers: () => {},
  }
  return {
    configStore: store,
    settings: {
      getAllowlist: () => undefined,
      getDenylist: () => undefined,
      isManagedOnly: () => false,
      isPluginOnlyLocked: () => false,
      isSourceEnabled: () => true,
      getProjectApprovalStatus: () => 'approved',
    },
    getCwd: () => '/workspace/project',
    ...overrides,
    configStore: { ...store, ...overrides.configStore },
    settings: overrides.settings ?? {
      getAllowlist: () => undefined,
      getDenylist: () => undefined,
      isManagedOnly: () => false,
      isPluginOnlyLocked: () => false,
      isSourceEnabled: () => true,
      getProjectApprovalStatus: () => 'approved',
    },
  }
}

test('project mcp traversal terminates on Windows drive roots', () => {
  const runtime = createRuntime({
    getCwd: () => 'D:\\VueProject\\ClaudeCode',
  })

  const result = withMcpConfigRuntime(runtime, () =>
    getMcpConfigsByScope('project'),
  )

  expect(result.servers).toEqual({})
})

test('dynamic MCP servers are returned with manual configs', async () => {
  const dynamic = {
    cliServer: {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      scope: 'dynamic',
    },
  } satisfies Record<string, McpServerConfig & { scope: 'dynamic' }>

  const result = await withMcpConfigRuntime(createRuntime(), () =>
    getCodePilotXMcpConfigs(dynamic),
  )

  expect(result.servers.cliServer).toEqual(dynamic.cliServer)
})

test('managed-only MCP allowlist does not merge user allowlist entries', async () => {
  const policyAllowlist: McpServerPolicyEntry[] = [{ serverName: 'managed' }]
  const runtime = createRuntime({
    configStore: {
      getUserMcpServers: () => ({
        userServer: {
          type: 'stdio',
          command: 'node',
          args: ['user.js'],
        },
      }),
    },
    settings: {
      getAllowlist: () => policyAllowlist,
      getDenylist: () => undefined,
      isManagedOnly: () => true,
      isPluginOnlyLocked: () => false,
      isSourceEnabled: () => true,
      getProjectApprovalStatus: () => 'approved',
    },
  })

  const result = await withMcpConfigRuntime(runtime, () =>
    getCodePilotXMcpConfigs(),
  )

  expect(result.servers.userServer).toBeUndefined()
})
