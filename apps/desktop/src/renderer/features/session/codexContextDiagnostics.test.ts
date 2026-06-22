import { expect, test } from 'bun:test'
import { buildWorkspaceCodexContextDiagnostics } from './codexContextDiagnostics.js'

test('buildWorkspaceCodexContextDiagnostics reads root guidance and project config with existing file API', async () => {
  const diagnostics = await buildWorkspaceCodexContextDiagnostics({
    workspacePath: 'D:\\VueProject\\ClaudeCode',
    readWorkspaceFile: async (_workspacePath, filePath) => {
      const normalized = filePath.replace(/\\/g, '/')
      if (normalized.endsWith('/AGENTS.override.md')) {
        return {
          path: filePath,
          content: '# Override guidance\n\n中文',
          truncated: false,
        }
      }
      if (normalized.endsWith('/AGENTS.md')) {
        return {
          path: filePath,
          content: '# Root guidance',
          truncated: false,
        }
      }
      if (normalized.endsWith('/.codex/config.toml')) {
        return {
          path: filePath,
          content: [
            'approval = "prompt"',
            'sandbox = "workspace-write"',
            'model_provider = "openai"',
            '[mcp_servers.docs]',
            'url = "https://example.com/mcp"',
          ].join('\n'),
          truncated: false,
        }
      }
      throw new Error(`missing ${filePath}`)
    },
  })

  expect(diagnostics.guidanceSources).toHaveLength(1)
  expect(diagnostics.guidanceSources[0]?.relativePath).toBe('AGENTS.override.md')
  expect(diagnostics.guidanceSources[0]?.isOverride).toBe(true)
  expect(diagnostics.guidanceSources[0]?.summary).toContain('中文')
  expect(diagnostics.projectConfig.config.approval).toBe('prompt')
  expect(diagnostics.projectConfig.config.mcpServers?.[0]?.url).toBe(
    'https://example.com/mcp',
  )
  expect(diagnostics.projectConfig.ignoredProjectKeys).toEqual([
    'model_provider',
  ])
})

test('buildWorkspaceCodexContextDiagnostics tolerates missing optional files', async () => {
  const diagnostics = await buildWorkspaceCodexContextDiagnostics({
    workspacePath: 'D:\\VueProject\\ClaudeCode',
    readWorkspaceFile: async () => {
      throw new Error('not found')
    },
  })

  expect(diagnostics.guidanceSources).toEqual([])
  expect(diagnostics.projectConfig.path).toBe(null)
  expect(diagnostics.projectConfig.config).toEqual({})
})
