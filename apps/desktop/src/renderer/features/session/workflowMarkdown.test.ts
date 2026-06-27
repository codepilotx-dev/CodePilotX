import { expect, test } from 'bun:test'
import type { WorkflowReducerDiagnostics } from '../../../shared/workflowReducer.js'
import type { DesktopWorkflowEvent } from '../../../shared/types.js'
import { buildWorkflowMarkdownReport } from './workflowMarkdown.js'

const base = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  createdAt: '2026-06-22T00:00:00.000Z',
} as const

const emptyDiagnostics: WorkflowReducerDiagnostics = {
  duplicateEventIds: [],
  missingToolResults: [],
  outOfOrderSequences: [],
}

test('buildWorkflowMarkdownReport exports workflow events as a markdown table', () => {
  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics: emptyDiagnostics,
    events: [
      {
        eventId: 'turn-started',
        sequence: 1,
        type: 'turn.started',
        ...base,
      },
      toolCall('tool-call', 2, 'Read', 'read a|b.ts\nnext line'),
      toolResult('tool-result', 3, 'Read', 'ok'),
    ],
  })

  expect(markdown).toContain('# Workflow 事件')
  expect(markdown).toContain('- Session: thread-1')
  expect(markdown).toContain('- 当前事件: 3 条')
  expect(markdown).toContain(
    '| 时间 | 类型 | thread | turn | item | detail |',
  )
  expect(markdown).toContain('tool=Read; toolUseId=tool-1')
  expect(markdown).toContain('summary=read a\\|b.ts next line')
})

test('buildWorkflowMarkdownReport includes diagnostics and log diagnostics', () => {
  const diagnostics: WorkflowReducerDiagnostics = {
    duplicateEventIds: ['event-1'],
    missingToolResults: ['tool-1', 'tool-2'],
    outOfOrderSequences: [{ previous: 4, current: 2 }],
  }

  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics,
    events: [toolCall('tool-call', 2, 'Bash', 'bun test')],
    logDiagnostics: {
      count: 12,
      diagnostics: emptyDiagnostics,
      note: '事件日志未启用|无日志事件',
    },
  })

  expect(markdown).toContain('- 当前诊断: 4 个（重复 1，未完成工具 2，乱序 1）')
  expect(markdown).toContain('- 日志事件: 12 条')
  expect(markdown).toContain('- 日志诊断: 0 个（重复 0，未完成工具 0，乱序 0）')
  expect(markdown).toContain('- 日志备注: 事件日志未启用\\|无日志事件')
})

test('buildWorkflowMarkdownReport includes consistency diagnostics', () => {
  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics: emptyDiagnostics,
    consistencyDiagnostics: {
      missingTurnCompletions: ['turn-1'],
      missingTurnCompletionDetails: [
        {
          turnId: 'turn-1',
          lastEventType: 'item.completed',
          lastEventCreatedAt: '2026-06-22T00:00:03.000Z',
          likelyStillRunning: true,
        },
      ],
      unpairedToolCalls: ['tool-1'],
      unpairedToolResults: ['tool-2'],
      pendingPermissionRequests: ['permission-1'],
      finalResponseMismatches: [
        { workflow: 'Workflow final', transcript: 'Transcript final' },
      ],
      mixedThreadIds: ['thread-2'],
    },
    events: [toolCall('tool-call', 2, 'Bash', 'bun test')],
  })

  expect(markdown).toContain(
    '- 一致性诊断: 6 个（缺 turn 终止事件 1，未配对 call 1，孤立 result 1，未决权限 1，最终回复不一致 1，混入 thread 1）',
  )
  expect(markdown).not.toContain('缺 terminal')
  expect(markdown).toContain('## 缺 turn 终止事件')
  expect(markdown).toContain('| turn | 最后事件 | 最后时间 | 判断 |')
  expect(markdown).toContain('| turn-1 | item.completed |')
  expect(markdown).toContain('可能仍在运行或复制过早')
})

test('buildWorkflowMarkdownReport includes Codex context diagnostics snapshot', () => {
  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics: emptyDiagnostics,
    codexContextDiagnostics: {
      guidanceSources: [
        {
          path: 'D:\\VueProject\\ClaudeCode\\AGENTS.md',
          relativePath: 'AGENTS.md',
          level: 0,
          isOverride: false,
          contentHash: '0123456789abcdef',
          summary: '# Root|中文',
        },
      ],
      projectConfig: {
        path: 'D:\\VueProject\\ClaudeCode\\.codepilotx\\config.toml',
        config: {
          approval: 'prompt',
          sandbox: 'workspace-write',
          projectRootMarkers: ['.git', 'package.json'],
          mcpServers: [
            {
              name: 'docs',
              source: '.codepilotx/config.toml',
              command: 'npx',
              args: ['-y', 'docs-mcp'],
            },
          ],
          hooks: [
            {
              event: 'PreToolUse',
              matcher: '^Bash$',
              commands: ['echo check|safe'],
              source: '.codepilotx/config.toml',
            },
          ],
        },
        ignoredProjectKeys: ['model_provider'],
        diagnostics: [],
      },
      permissionProfile: {
        profile: 'workspace-write',
        approvalMode: 'prompt',
        sandboxPolicy: 'workspace-write',
      },
      skills: [
        {
          name: 'openai-docs',
          description: 'OpenAI docs lookup',
          path: 'skills/openai-docs/SKILL.md',
        },
      ],
    },
    events: [],
  })

  expect(markdown).toContain('## Codex 上下文快照')
  expect(markdown).toContain(
    '| AGENTS.md | 0 | 否 | 0123456789abcdef | # Root\\|中文 |',
  )
  expect(markdown).toContain('- Codex config: .codepilotx/config.toml')
  expect(markdown).toContain('- 忽略项目级配置键: model_provider')
  expect(markdown).toContain(
    '- 权限 profile: workspace-write / approval=prompt / sandbox=workspace-write',
  )
  expect(markdown).toContain(
    '| docs | mcp | .codepilotx/config.toml | command=npx -y docs-mcp |',
  )
  expect(markdown).toContain(
    '| PreToolUse | hook | .codepilotx/config.toml | matcher=^Bash$; commands=echo check\\|safe |',
  )
  expect(markdown).toContain(
    '| openai-docs | skill | skills/openai-docs/SKILL.md | OpenAI docs lookup |',
  )
})

test('buildWorkflowMarkdownReport expands failed tool result metadata', () => {
  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics: emptyDiagnostics,
    events: [
      toolResult('tool-result', 1, 'Bash', 'Bash', true, {
        result: {
          stderr: 'command failed|bad flag\nusage: bun test',
          stdout: 'partial output',
        },
      }),
    ],
  })

  expect(markdown).toContain('tool=Bash; toolUseId=tool-1')
  expect(markdown).toContain('stderr=command failed\\|bad flag usage: bun test')
  expect(markdown).toContain('stdout=partial output')
  expect(markdown).not.toContain('summary=Bash')
})

test('buildWorkflowMarkdownReport falls back to summary without result metadata', () => {
  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics: emptyDiagnostics,
    events: [toolResult('tool-result', 1, 'Glob', 'Glob', true)],
  })

  expect(markdown).toContain('summary=Glob')
})

test('buildWorkflowMarkdownReport handles empty events', () => {
  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics: emptyDiagnostics,
    events: [],
  })

  expect(markdown).toContain('- 当前事件: 0 条')
  expect(markdown).toContain('| - | - | - | - | - | 暂无 workflow 事件 |')
})

test('buildWorkflowMarkdownReport filters by active session and limits output', () => {
  const markdown = buildWorkflowMarkdownReport({
    activeSessionId: 'thread-1',
    diagnostics: emptyDiagnostics,
    events: [
      toolCall('other', 1, 'Read', 'other thread', 'thread-2'),
      toolCall('a', 2, 'Read', 'first'),
      toolCall('b', 3, 'Read', 'second'),
    ],
    limit: 1,
  })

  expect(markdown).toContain('- 当前事件: 2 条')
  expect(markdown).toContain('- 导出事件: 1 条')
  expect(markdown).toContain('summary=second')
  expect(markdown).not.toContain('summary=first')
  expect(markdown).not.toContain('other thread')
})

function toolCall(
  eventId: string,
  sequence: number,
  toolName: string,
  summary: string,
  threadId = 'thread-1',
): DesktopWorkflowEvent {
  return {
    eventId,
    sequence,
    type: 'item.started',
    ...base,
    threadId,
    item: {
      id: 'tool_call-tool-1',
      type: 'tool_call',
      status: 'in_progress',
      createdAt: base.createdAt,
      ...base,
      threadId,
      toolName,
      toolUseId: 'tool-1',
      summary,
    },
  }
}

function toolResult(
  eventId: string,
  sequence: number,
  toolName: string,
  summary: string,
  isError = false,
  metadata?: Record<string, unknown>,
): DesktopWorkflowEvent {
  return {
    eventId,
    sequence,
    type: 'item.completed',
    ...base,
    item: {
      id: 'tool_result-tool-1',
      type: 'tool_result',
      status: isError ? 'failed' : 'completed',
      createdAt: base.createdAt,
      ...base,
      toolName,
      toolUseId: 'tool-1',
      summary,
      isError,
      ...(metadata ? { metadata } : {}),
    },
  }
}
