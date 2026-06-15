import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/tui/utils/envUtils.js'
import { getProjectDir } from '@codepilotx/tui/utils/sessionStorage.js'
import {
  getDesktopSessionIndexPath,
  loadDesktopSessionStore,
} from './sessionPersistence.js'
import { getStandaloneWorkspacePath } from './standaloneWorkspace.js'

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
