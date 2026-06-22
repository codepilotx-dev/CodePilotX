import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  buildCodexContextDiagnostics,
  discoverCodexGuidanceSources,
  readCodexProjectConfig,
} from './codexContextDiagnostics.js'

test('discoverCodexGuidanceSources follows root to cwd order and override priority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-guidance-'))
  try {
    const appDir = join(root, 'apps', 'desktop')
    await mkdir(appDir, { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), '# Root\n\nread as utf-8: 中文')
    await writeFile(join(root, 'apps', 'AGENTS.md'), '# Apps')
    await writeFile(join(appDir, 'AGENTS.md'), '# Ignored')
    await writeFile(join(appDir, 'AGENTS.override.md'), '# Desktop Override')

    const sources = await discoverCodexGuidanceSources({
      projectRoot: root,
      cwd: appDir,
    })

    expect(sources.map(source => source.relativePath)).toEqual([
      'AGENTS.md',
      'apps/AGENTS.md',
      'apps/desktop/AGENTS.override.md',
    ])
    expect(sources.map(source => source.level)).toEqual([0, 1, 2])
    expect(sources[0]?.isOverride).toBe(false)
    expect(sources[2]?.isOverride).toBe(true)
    expect(sources[0]?.summary).toContain('中文')
    expect(sources[0]?.contentHash).toMatch(/^[a-f0-9]{16}$/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('readCodexProjectConfig parses supported project config and reports ignored keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-config-'))
  try {
    await mkdir(join(root, '.codex'), { recursive: true })
    await writeFile(
      join(root, '.codex', 'config.toml'),
      [
        'approval = "prompt"',
        'sandbox = "workspace-write"',
        'project_root_markers = [".git", "package.json"]',
        'model_provider = "openai"',
        'profile = "work"',
        '',
        '[mcp_servers.docs]',
        'command = "npx"',
        'args = ["-y", "docs-mcp"]',
        '',
        '[[hooks.PreToolUse]]',
        'matcher = "^Bash$"',
        '[[hooks.PreToolUse.hooks]]',
        'type = "command"',
        'command = "echo check"',
      ].join('\n'),
    )

    const config = await readCodexProjectConfig(root)

    expect(config.path).toBe(join(root, '.codex', 'config.toml'))
    expect(config.config).toMatchObject({
      approval: 'prompt',
      sandbox: 'workspace-write',
      projectRootMarkers: ['.git', 'package.json'],
    })
    expect(config.config.mcpServers).toEqual([
      {
        name: 'docs',
        source: '.codex/config.toml',
        command: 'npx',
        args: ['-y', 'docs-mcp'],
        url: undefined,
      },
    ])
    expect(config.config.hooks).toEqual([
      {
        event: 'PreToolUse',
        matcher: '^Bash$',
        commands: ['echo check'],
        source: '.codex/config.toml',
      },
    ])
    expect(config.ignoredProjectKeys).toEqual(['model_provider', 'profile'])
    expect(config.diagnostics).toEqual([])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('readCodexProjectConfig reports invalid TOML without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-config-invalid-'))
  try {
    await mkdir(join(root, '.codex'), { recursive: true })
    await writeFile(join(root, '.codex', 'config.toml'), 'approval = "prompt')

    const config = await readCodexProjectConfig(root)

    expect(config.config).toEqual({})
    expect(config.diagnostics[0]).toContain('无法解析 .codex/config.toml')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('buildCodexContextDiagnostics aggregates guidance config hooks MCP skills and permission profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-context-'))
  try {
    await mkdir(join(root, '.codex'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), '# Root guidance')
    await writeFile(
      join(root, '.codex', 'config.toml'),
      [
        'approval = "prompt"',
        '[mcp_servers.docs]',
        'url = "https://example.com/mcp"',
      ].join('\n'),
    )

    const diagnostics = await buildCodexContextDiagnostics({
      projectRoot: root,
      cwd: root,
      permissionProfile: {
        profile: 'workspace-write',
        approvalMode: 'prompt',
      },
      skills: [
        {
          name: 'openai-docs',
          description: 'OpenAI docs lookup',
          path: 'skills/openai-docs/SKILL.md',
        },
      ],
    })

    expect(diagnostics.guidanceSources).toHaveLength(1)
    expect(diagnostics.projectConfig.config.mcpServers?.[0]?.name).toBe('docs')
    expect(diagnostics.permissionProfile?.profile).toBe('workspace-write')
    expect(diagnostics.skills).toEqual([
      {
        name: 'openai-docs',
        description: 'OpenAI docs lookup',
        path: 'skills/openai-docs/SKILL.md',
      },
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
