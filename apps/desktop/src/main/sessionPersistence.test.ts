import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { expect, spyOn, test } from 'bun:test'
import { WorkflowEventSchemaVersion } from '@codepilotx/core/agent/workflow.js'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import { getProjectDir } from '@codepilotx/core/session/storage.js'
import {
  applyDesktopAgentEventToSnapshot,
  applyDesktopWorkflowEventsToSnapshot,
  appendDesktopRolloutItems,
  buildDesktopSessionIndexTempPath,
  createDesktopSessionSnapshot,
  getDesktopSessionIndexPath,
  hydrateDesktopSessionSnapshot,
  loadDesktopSessionStore,
  saveDesktopSessionStore,
  writeFileAtomically,
} from './sessionPersistence.js'
import { getStandaloneWorkspacePath } from './standaloneWorkspace.js'
import type { DesktopWorkflowEvent } from '../shared/types.js'

test('transcript-only standalone chat restores outside project groups', async () => {
  await withDesktopConfig(async () => {
    const sessionId = randomUUID()
    const standalonePath = getStandaloneWorkspacePath()
    await writeTranscript(standalonePath, sessionId, 'hello standalone')

    const store = await loadDesktopSessionStore()
    const snapshot = store.sessions.find(item => item.item.id === sessionId)

    expect(snapshot?.item.standalone).toBe(true)
    expect(snapshot?.workspace.isStandalone).toBe(true)
    expect(snapshot?.workspace.name).toBe('Standalone Chat')
    expect(snapshot?.item.workspaceName).toBe('Standalone Chat')
    expect(snapshot?.item.workspacePath).toBe(standalonePath)
  })
})

test('legacy standalone overlay is normalized on restore', async () => {
  await withDesktopConfig(async () => {
    const sessionId = randomUUID()
    const standalonePath = getStandaloneWorkspacePath()
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const indexPath = getDesktopSessionIndexPath()
    await mkdir(dirname(indexPath), { recursive: true })
    await writeFile(
      indexPath,
      JSON.stringify(
        {
          activeSessionId: sessionId,
          sessions: [
            {
              id: sessionId,
              workspace: {
                path: standalonePath,
                name: basename(standalonePath),
                branchName: null,
                isGitRepo: false,
              },
              settings: {
                permissionMode: 'default',
                thinkingMode: 'default',
                additionalDirectories: [],
              },
              standalone: false,
              status: 'done',
              createdAt: now,
              lastMessageAt: now,
              updatedAt: now,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const store = await loadDesktopSessionStore()
    const snapshot = store.sessions.find(item => item.item.id === sessionId)

    expect(snapshot?.item.standalone).toBe(true)
    expect(snapshot?.workspace.isStandalone).toBe(true)
    expect(snapshot?.workspace.name).toBe('Standalone Chat')
    expect(snapshot?.item.workspaceName).toBe('Standalone Chat')
  })
})

test('real project transcript remains project-scoped', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const projectPath = join(configDir, 'real-project')
    await writeTranscript(projectPath, sessionId, 'hello project')

    const store = await loadDesktopSessionStore()
    const snapshot = store.sessions.find(item => item.item.id === sessionId)

    expect(snapshot?.item.standalone).toBe(false)
    expect(snapshot?.workspace.isStandalone).not.toBe(true)
    expect(snapshot?.workspace.name).toBe('real-project')
    expect(snapshot?.item.workspacePath).toBe(projectPath)
  })
})

test('transcript restore preserves tool use ids in session events', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const projectPath = join(configDir, 'tool-use-project')
    const timestamp = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const promptUuid = randomUUID()
    const assistantUuid = randomUUID()
    const resultUuid = randomUUID()
    await writeTranscriptEntries(projectPath, sessionId, [
      transcriptMessage({
        uuid: promptUuid,
        sessionId,
        workspacePath: projectPath,
        timestamp,
        role: 'user',
        content: 'Ask a question',
      }),
      transcriptMessage({
        uuid: assistantUuid,
        parentUuid: promptUuid,
        sessionId,
        workspacePath: projectPath,
        timestamp,
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call-question-1',
            name: 'AskUserQuestion',
            input: {},
          },
        ],
      }),
      transcriptMessage({
        uuid: resultUuid,
        parentUuid: assistantUuid,
        sessionId,
        workspacePath: projectPath,
        timestamp,
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-question-1',
            content: 'InputValidationError',
            is_error: true,
          },
        ],
      }),
    ])

    const store = await loadDesktopSessionStore()
    const snapshot = store.sessions.find(item => item.item.id === sessionId)
    const hydrated = snapshot
      ? await hydrateDesktopSessionSnapshot(snapshot)
      : undefined
    const toolEvents = hydrated?.events.filter(
      event => event.type === 'tool_call' || event.type === 'tool_result',
    )

    expect(toolEvents).toHaveLength(2)
    expect(toolEvents?.map(event => event.metadata?.toolUseId)).toEqual([
      'call-question-1',
      'call-question-1',
    ])
  })
})

test('new desktop session snapshots include rollout metadata', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const projectPath = join(configDir, 'rollout-project')
    const snapshot = createDesktopSessionSnapshot({
      sessionId,
      workspace: {
        path: projectPath,
        name: 'rollout-project',
        branchName: null,
        isGitRepo: false,
      },
      standalone: false,
      settings: {
        permissionMode: 'default',
        thinkingMode: 'default',
        additionalDirectories: [],
      },
    })

    expect(snapshot.item.rolloutPath).toBe(
      join(getProjectDir(projectPath), `${sessionId}.rollout.jsonl`),
    )
    expect(snapshot.item.legacyTranscriptPath).toBe(
      join(getProjectDir(projectPath), `${sessionId}.jsonl`),
    )
    expect(snapshot.item.source).toBe('user')
  })
})

test('hydrateDesktopSessionSnapshot prefers rollout over legacy transcript and filters reviewer prompts', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const projectPath = join(configDir, 'rollout-hydrate-project')
    await writeTranscript(projectPath, sessionId, 'legacy prompt')
    const rolloutPath = join(getProjectDir(projectPath), `${sessionId}.rollout.jsonl`)
    await appendDesktopRolloutItems(rolloutPath, [
      {
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp: '2026-01-01T00:00:00.000Z',
          cwd: projectPath,
          originator: 'desktop',
          cli_version: 'test',
          source: 'user',
        },
      },
      {
        type: 'event_msg',
        payload: {
          eventType: 'message',
          role: 'assistant',
          content:
            'Review this permission request. Return only JSON.\n\nInput JSON: {}\n\nAllowed output schema:',
          createdAt: '2026-01-01T00:00:01.000Z',
        },
      },
      {
        type: 'event_msg',
        payload: {
          eventType: 'message',
          role: 'user',
          content: 'Review this permission request. Return only JSON.',
          createdAt: '2026-01-01T00:00:01.500Z',
        },
      },
      {
        type: 'event_msg',
        payload: {
          eventType: 'message',
          role: 'assistant',
          content: '{"error":"No permission request provided to review."}',
          createdAt: '2026-01-01T00:00:01.750Z',
        },
      },
      {
        type: 'event_msg',
        payload: {
          eventType: 'message',
          role: 'assistant',
          content: 'rollout response',
          createdAt: '2026-01-01T00:00:02.000Z',
        },
      },
    ])
    const snapshot = createDesktopSessionSnapshot({
      sessionId,
      workspace: {
        path: projectPath,
        name: 'rollout-hydrate-project',
        branchName: null,
        isGitRepo: false,
      },
      standalone: false,
      settings: {
        permissionMode: 'default',
        thinkingMode: 'default',
        additionalDirectories: [],
      },
    })

    const hydrated = await hydrateDesktopSessionSnapshot(snapshot)

    expect(hydrated.view.messages.map(message => message.text)).toEqual([
      'rollout response',
    ])
    expect(hydrated.view.messages.some(message => message.text.includes('legacy prompt'))).toBe(false)
    expect(hydrated.view.messages.some(message => message.text.includes('Review this permission request'))).toBe(false)
  })
})

test('guardian review events store hidden rollout path in session metadata', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const projectPath = join(configDir, 'guardian-parent-project')
    const snapshot = createDesktopSessionSnapshot({
      sessionId,
      workspace: {
        path: projectPath,
        name: 'guardian-parent-project',
        branchName: null,
        isGitRepo: false,
      },
      standalone: false,
      settings: {
        permissionMode: 'default',
        thinkingMode: 'default',
        additionalDirectories: [],
      },
    })

    const updated = applyDesktopAgentEventToSnapshot(snapshot, {
      type: 'guardian_review',
      sessionId,
      reviewId: 'guardian-review-1',
      targetRequestId: 'permission-1',
      status: 'approved',
      riskLevel: 'low',
      userAuthorization: 'high',
      rationale: 'safe',
      action: {
        type: 'command',
        source: 'PowerShell',
        command: 'echo ok',
      },
      guardianRolloutPath: join(projectPath, '.guardian.rollout.jsonl'),
    })

    expect(updated.item.guardianRolloutPath).toBe(
      join(projectPath, '.guardian.rollout.jsonl'),
    )
    expect(updated.view.messages).toEqual([])
    expect(updated.events?.at(-1)?.metadata).toMatchObject({
      guardianRolloutPath: join(projectPath, '.guardian.rollout.jsonl'),
    })
  })
})

test('legacy snapshot workflow events are normalized on restore', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const projectPath = join(configDir, 'workflow-project')
    const indexPath = getDesktopSessionIndexPath()
    await mkdir(dirname(indexPath), { recursive: true })
    await writeFile(
      indexPath,
      JSON.stringify(
        {
          activeSessionId: sessionId,
          sessions: [
            {
              item: sessionItem(sessionId, projectPath, now),
              workspace: {
                path: projectPath,
                name: 'workflow-project',
                branchName: null,
                isGitRepo: false,
              },
              settings: {
                permissionMode: 'default',
                thinkingMode: 'default',
                additionalDirectories: [],
              },
              view: {
                messages: [],
                toolLog: [],
                pendingPermissions: [],
                contextUsage: null,
              },
              events: [],
              eventModelVersion: 1,
              workflowEvents: [
                {
                  type: 'thread.started',
                  threadId: sessionId,
                  createdAt: now,
                },
              ],
              workflowEventModelVersion: 1,
              updatedAt: now,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const store = await loadDesktopSessionStore()
    const snapshot = store.sessions.find(item => item.item.id === sessionId)

    expect(snapshot?.workflowEvents?.[0]).toMatchObject({
      type: 'thread.started',
      schemaVersion: WorkflowEventSchemaVersion,
      threadId: sessionId,
    })
  })
})

test('duplicate overlay session ids keep the first record and warn', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const projectPath = join(configDir, 'duplicate-project')
    const indexPath = getDesktopSessionIndexPath()
    await mkdir(dirname(indexPath), { recursive: true })
    await writeFile(
      indexPath,
      JSON.stringify(
        {
          activeSessionId: sessionId,
          sessions: [
            persistedOverlay(sessionId, projectPath, 'first', now),
            persistedOverlay(sessionId, projectPath, 'second', now),
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const store = await loadDesktopSessionStore()
      const snapshot = store.sessions.find(item => item.item.id === sessionId)

      expect(snapshot?.item.sessionName).toBe('first')
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`Duplicate desktop session id ignored: ${sessionId}`),
      )
    } finally {
      warn.mockRestore()
    }
  })
})

test('session index temp path stays beside the final sessions file', () => {
  const filePath = join('C:\\Users\\tester\\config', 'sessions.json')

  expect(buildDesktopSessionIndexTempPath(filePath, 'nonce')).toBe(
    join('C:\\Users\\tester\\config', '.sessions.json.nonce.tmp'),
  )
})

test('writeFileAtomically writes temp file before replacing final file', async () => {
  const calls: string[] = []
  const filePath = join('C:\\Users\\tester\\config', 'sessions.json')

  await writeFileAtomically(filePath, '{"ok":true}', {
    mkdir: async path => {
      calls.push(`mkdir:${path}`)
    },
    writeFile: async (path, content) => {
      calls.push(`write:${path}:${content}`)
    },
    rename: async (from, to) => {
      calls.push(`rename:${from}:${to}`)
    },
  }, 'nonce')

  const tempPath = join('C:\\Users\\tester\\config', '.sessions.json.nonce.tmp')
  expect(calls).toEqual([
    `mkdir:${join('C:\\Users\\tester\\config')}`,
    `write:${tempPath}:{"ok":true}`,
    `rename:${tempPath}:${filePath}`,
  ])
})

test('writeFileAtomically retries transient Windows rename permission failures', async () => {
  const calls: string[] = []
  const filePath = join('C:\\Users\\tester\\config', 'sessions.json')
  let renameAttempts = 0

  await writeFileAtomically(filePath, '{"ok":true}', {
    mkdir: async path => {
      calls.push(`mkdir:${path}`)
    },
    writeFile: async (path, content) => {
      calls.push(`write:${path}:${content}`)
    },
    rename: async (from, to) => {
      renameAttempts += 1
      calls.push(`rename:${renameAttempts}:${from}:${to}`)
      if (renameAttempts < 3) {
        const error = new Error('operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
    },
  }, 'nonce')

  const tempPath = join('C:\\Users\\tester\\config', '.sessions.json.nonce.tmp')
  expect(calls).toEqual([
    `mkdir:${join('C:\\Users\\tester\\config')}`,
    `write:${tempPath}:{"ok":true}`,
    `rename:1:${tempPath}:${filePath}`,
    `rename:2:${tempPath}:${filePath}`,
    `rename:3:${tempPath}:${filePath}`,
  ])
})

test('writeFileAtomically removes temp file when rename retries are exhausted', async () => {
  const calls: string[] = []
  const filePath = join('C:\\Users\\tester\\config', 'sessions.json')
  const renameError = new Error('operation not permitted') as NodeJS.ErrnoException
  renameError.code = 'EPERM'

  await expect(
    writeFileAtomically(filePath, '{"ok":true}', {
      mkdir: async path => {
        calls.push(`mkdir:${path}`)
      },
      writeFile: async (path, content) => {
        calls.push(`write:${path}:${content}`)
      },
      rename: async (from, to) => {
        calls.push(`rename:${from}:${to}`)
        throw renameError
      },
      unlink: async path => {
        calls.push(`unlink:${path}`)
      },
    } as Parameters<typeof writeFileAtomically>[2] & {
      unlink(path: string): Promise<unknown>
    }, 'nonce'),
  ).rejects.toBe(renameError)

  const tempPath = join('C:\\Users\\tester\\config', '.sessions.json.nonce.tmp')
  expect(calls).toContain(`unlink:${tempPath}`)
})

test('AskUserQuestion pending permission with tool use id survives desktop restart', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const projectPath = join(configDir, 'question-project')
    let snapshot = createDesktopSessionSnapshot({
      sessionId,
      workspace: {
        path: projectPath,
        name: 'question-project',
        branchName: null,
        isGitRepo: false,
      },
      standalone: false,
      settings: {
        permissionMode: 'default',
        thinkingMode: 'default',
        additionalDirectories: [],
      },
    })
    snapshot = {
      ...snapshot,
      item: {
        ...snapshot.item,
        status: 'waiting',
        createdAt: now,
        lastMessageAt: now,
      },
      view: {
        ...snapshot.view,
        pendingPermissions: [
          {
            requestId: 'permission-1',
            toolName: 'AskUserQuestion',
            toolUseId: 'call-question-1',
            description: 'Answer question',
            input: {
              questions: [
                {
                  question: 'First choice?',
                  header: 'Choice',
                  options: [
                    { label: 'A', description: 'Choose A' },
                    { label: 'B', description: 'Choose B' },
                  ],
                },
              ],
            },
          },
        ],
        messages: [
          {
            id: 'message-1',
            role: 'assistant',
            text: 'Waiting for answer',
            createdAt: now,
            streaming: true,
          },
        ],
      },
      updatedAt: now,
    }

    await saveDesktopSessionStore({
      activeSessionId: sessionId,
      sessions: [snapshot],
    })

    const store = await loadDesktopSessionStore()
    const restored = store.sessions.find(item => item.item.id === sessionId)

    expect(restored?.item.status).toBe('waiting')
    expect(restored?.view.pendingPermissions).toEqual([
      expect.objectContaining({
        requestId: 'permission-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'call-question-1',
      }),
    ])
    expect(restored?.view.messages[0]?.streaming).toBe(false)
  })
})

test('ExitPlanMode pending permission survives desktop restart', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const projectPath = join(configDir, 'plan-project')
    let snapshot = createDesktopSessionSnapshot({
      sessionId,
      workspace: {
        path: projectPath,
        name: 'plan-project',
        branchName: null,
        isGitRepo: false,
      },
      standalone: false,
      settings: {
        permissionMode: 'default',
        planModeActive: true,
        thinkingMode: 'default',
        additionalDirectories: [],
      },
    })
    snapshot = {
      ...snapshot,
      item: {
        ...snapshot.item,
        status: 'waiting',
        createdAt: now,
        lastMessageAt: now,
      },
      view: {
        ...snapshot.view,
        pendingPermissions: [
          {
            requestId: 'plan-permission-1',
            toolName: 'ExitPlanMode',
            description: '确认计划',
            input: {
              plan: '# 计划\n\n- 实施功能',
              source: 'proposed_plan',
            },
          },
        ],
      },
      updatedAt: now,
    }

    await saveDesktopSessionStore({
      activeSessionId: sessionId,
      sessions: [snapshot],
    })

    const store = await loadDesktopSessionStore()
    const restored = store.sessions.find(item => item.item.id === sessionId)

    expect(restored?.item.status).toBe('waiting')
    expect(restored?.view.pendingPermissions).toEqual([
      expect.objectContaining({
        requestId: 'plan-permission-1',
        toolName: 'ExitPlanMode',
        input: expect.objectContaining({
          plan: '# 计划\n\n- 实施功能',
        }),
      }),
    ])
  })
})

test('overlay workflow events are saved and restored without transcript state', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const projectPath = join(configDir, 'workflow-overlay-project')
    const snapshot = applyDesktopWorkflowEventsToSnapshot(
      createDesktopSessionSnapshot({
        sessionId,
        workspace: {
          path: projectPath,
          name: 'workflow-overlay-project',
          branchName: null,
          isGitRepo: false,
        },
        standalone: false,
        settings: {
          permissionMode: 'default',
          thinkingMode: 'default',
          additionalDirectories: [],
        },
      }),
      [threadStarted(sessionId, now)],
    )

    await saveDesktopSessionStore({
      activeSessionId: sessionId,
      sessions: [snapshot],
    })

    const store = await loadDesktopSessionStore()
    const restored = store.sessions.find(item => item.item.id === sessionId)

    expect(restored?.workflowEvents).toHaveLength(1)
    expect(restored?.workflowEvents?.[0]).toMatchObject({
      type: 'thread.started',
      schemaVersion: WorkflowEventSchemaVersion,
      threadId: sessionId,
    })
  })
})

test('review comments are saved, restored, and invalid records are ignored', async () => {
  await withDesktopConfig(async configDir => {
    const sessionId = randomUUID()
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
    const projectPath = join(configDir, 'review-comment-project')
    const snapshot = createDesktopSessionSnapshot({
      sessionId,
      workspace: {
        path: projectPath,
        name: 'review-comment-project',
        branchName: null,
        isGitRepo: false,
      },
      standalone: false,
      settings: {
        permissionMode: 'default',
        thinkingMode: 'default',
        additionalDirectories: [],
      },
    })
    snapshot.reviewComments = [
      {
        id: 'review-comment-1',
        sessionId,
        filePath: 'src/index.ts',
        side: 'right',
        lineNumber: 12,
        lineContent: 'const value = nextValue',
        body: '这里需要处理空值。',
        status: 'open',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '',
        sessionId,
        filePath: 'src/bad.ts',
        side: 'right',
        lineNumber: 1,
        lineContent: 'bad',
        body: 'bad',
        status: 'open',
        createdAt: now,
        updatedAt: now,
      },
    ]

    await saveDesktopSessionStore({
      activeSessionId: sessionId,
      sessions: [snapshot],
    })

    const store = await loadDesktopSessionStore()
    const restored = store.sessions.find(item => item.item.id === sessionId)

    expect(restored?.reviewComments).toEqual([
      expect.objectContaining({
        id: 'review-comment-1',
        filePath: 'src/index.ts',
        lineNumber: 12,
        status: 'open',
      }),
    ])
  })
})

test('applying workflow events normalizes events and skips duplicates', () => {
  const sessionId = randomUUID()
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
  const snapshot = createDesktopSessionSnapshot({
    sessionId,
    workspace: {
      path: 'D:\\project',
      name: 'project',
      branchName: null,
      isGitRepo: false,
    },
    standalone: false,
    settings: {
      permissionMode: 'default',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
  })
  const event = threadStarted(sessionId, now)

  const next = applyDesktopWorkflowEventsToSnapshot(snapshot, [
    event,
    event,
    { type: 'not-real' } as unknown as DesktopWorkflowEvent,
  ])

  expect(next.workflowEvents).toHaveLength(1)
  expect(next.workflowEvents?.[0]).toMatchObject({
    eventId: expect.any(String),
    schemaVersion: WorkflowEventSchemaVersion,
    threadId: sessionId,
  })
})

async function withDesktopConfig(
  run: (configDir: string) => Promise<void>,
): Promise<void> {
  const previousCodePilotXConfig = process.env[CODEPILOTX_CONFIG_DIR_ENV]
  const previousClaudeConfig = process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  const configDir = await mkdtemp(join(tmpdir(), 'desktop-session-test-'))
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = configDir
  try {
    await run(configDir)
  } finally {
    restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, previousCodePilotXConfig)
    restoreEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, previousClaudeConfig)
    await rm(configDir, { recursive: true, force: true })
  }
}

async function writeTranscript(
  workspacePath: string,
  sessionId: string,
  content: string,
): Promise<void> {
  const transcriptPath = join(getProjectDir(workspacePath), `${sessionId}.jsonl`)
  await mkdir(dirname(transcriptPath), { recursive: true })
  await writeFile(
    transcriptPath,
    `${JSON.stringify({
      type: 'user',
      uuid: randomUUID(),
      parentUuid: null,
      sessionId,
      cwd: workspacePath,
      timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      version: 'test',
      userType: 'external',
      message: {
        role: 'user',
        content,
      },
    })}\n`,
    'utf8',
  )
}

async function writeTranscriptEntries(
  workspacePath: string,
  sessionId: string,
  entries: unknown[],
): Promise<void> {
  const transcriptPath = join(getProjectDir(workspacePath), `${sessionId}.jsonl`)
  await mkdir(dirname(transcriptPath), { recursive: true })
  await writeFile(
    transcriptPath,
    `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  )
}

function transcriptMessage({
  sessionId,
  workspacePath,
  timestamp,
  role,
  content,
  uuid = randomUUID(),
  parentUuid = null,
}: {
  sessionId: string
  workspacePath: string
  timestamp: string
  role: 'user' | 'assistant'
  content: unknown
  uuid?: string
  parentUuid?: string | null
}) {
  return {
    type: role,
    uuid,
    parentUuid,
    sessionId,
    cwd: workspacePath,
    timestamp,
    version: 'test',
    userType: 'external',
    message: {
      role,
      content,
    },
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function sessionItem(sessionId: string, projectPath: string, now: string) {
  return {
    id: sessionId,
    sessionName: null,
    aiTitle: null,
    customTitle: null,
    tag: null,
    summary: null,
    gitBranch: null,
    firstPrompt: null,
    prNumber: null,
    prUrl: null,
    prRepository: null,
    transcriptPath: null,
    fileSize: null,
    workspaceName: 'workflow-project',
    workspacePath: projectPath,
    standalone: false,
    pinnedAt: null,
    archivedAt: null,
    permissionMode: 'default',
    model: null,
    thinkingMode: 'default',
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: 'done',
    lastMessageAt: now,
    createdAt: now,
  }
}

function persistedOverlay(
  sessionId: string,
  projectPath: string,
  sessionName: string,
  timestamp: string,
) {
  return {
    id: sessionId,
    workspace: {
      path: projectPath,
      name: basename(projectPath),
      branchName: null,
      isGitRepo: false,
    },
    settings: {
      permissionMode: 'default',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
    standalone: false,
    sessionName,
    status: 'done',
    createdAt: timestamp,
    lastMessageAt: timestamp,
    updatedAt: timestamp,
  }
}

function threadStarted(
  sessionId: string,
  createdAt: string,
): DesktopWorkflowEvent {
  return {
    eventId: 'workflow-event-1',
    type: 'thread.started',
    threadId: sessionId,
    createdAt,
  }
}
