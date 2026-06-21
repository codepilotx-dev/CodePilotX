import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { expect, test } from 'bun:test'
import { WorkflowEventSchemaVersion } from '@codepilotx/core/agent/workflow.js'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/tui/utils/envUtils.js'
import { getProjectDir } from '@codepilotx/tui/utils/sessionStorage.js'
import {
  applyDesktopWorkflowEventsToSnapshot,
  createDesktopSessionSnapshot,
  getDesktopSessionIndexPath,
  loadDesktopSessionStore,
  saveDesktopSessionStore,
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
    fallbackModel: null,
    thinkingMode: 'default',
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: 'done',
    lastMessageAt: now,
    createdAt: now,
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
