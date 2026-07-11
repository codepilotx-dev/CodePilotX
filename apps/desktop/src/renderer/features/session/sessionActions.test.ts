import { afterEach, expect, mock, test } from 'bun:test'
import { desktopClient } from '../../services/desktopClient.js'
import type {
  DesktopUserMessageInput,
} from '../../../shared/types.js'
import {
  activateSession,
  submitSessionMessageAction,
  type SessionActionContext,
  type SessionSettingsSnapshot,
} from './sessionActions.js'

const settings: SessionSettingsSnapshot = {
  permissionMode: 'default',
  planModeActive: false,
  localRouterMode: 'off',
  providerID: 'anthropic',
  providerBaseURL: '',
  debugConversationDump: false,
  model: 'test-model',
  planExecutionModel: '',
  reviewModel: '',
  smallFastModel: '',
  fastModel: '',
  defaultModel: '',
  deepModel: '',
  sessionName: '',
  thinkingMode: 'disabled',
  followUpBehavior: 'steer',
  systemPrompt: '',
  appendSystemPrompt: '',
  additionalDirectories: '',
  installCodePilotXDependencies: false,
  enableMemory: false,
  rustSearchAndDiffKernels: false,
}

const originalSubmitSessionFollowUp = desktopClient.submitSessionFollowUp
const originalSendUserMessage = desktopClient.sendUserMessage

afterEach(() => {
  desktopClient.submitSessionFollowUp = originalSubmitSessionFollowUp
  desktopClient.sendUserMessage = originalSendUserMessage
})

test('activateSession does nothing when the active session id is unchanged', () => {
  const setSessionId = mock()
  const setSessionStatus = mock()
  const setSessions = mock()
  const context = {
    activeSessionIdRef: { current: null },
    sessionViewsRef: { current: {} },
    sessionWorkspacesRef: { current: {} },
    onErrorRef: { current: mock() },
    viewSetters: {
      setEvents: mock(),
      setWorkflowEvents: mock(),
      setMessages: mock(),
      setToolLog: mock(),
      setPendingPermissions: mock(),
      setContextUsage: mock(),
    },
    setSessions,
    setSessionId,
    setSessionStatus,
  } as unknown as SessionActionContext

  activateSession(context, null)

  expect(setSessionId).not.toHaveBeenCalled()
  expect(setSessionStatus).not.toHaveBeenCalled()
  expect(setSessions).not.toHaveBeenCalled()
})

test('running session submits follow-up using persisted behavior', async () => {
  const submitSessionFollowUp = mock(async () => 'queued' as const)
  const sendUserMessage = mock(async () => undefined)
  desktopClient.submitSessionFollowUp = submitSessionFollowUp
  desktopClient.sendUserMessage = sendUserMessage

  await submitSessionMessageAction(
    { current: mock() },
    'session-1',
    { text: '继续修改' },
    true,
    { ...settings, followUpBehavior: 'queue' },
    mock(),
    { sessionStatus: 'running', followUpBehavior: 'queue' },
  )

  expect(submitSessionFollowUp).toHaveBeenCalledWith(
    'session-1',
    { text: '继续修改' },
    'queue',
  )
  expect(sendUserMessage).not.toHaveBeenCalled()
})

test('waiting session submits a follow-up', async () => {
  const submitSessionFollowUp = mock(async () => 'steered' as const)
  desktopClient.submitSessionFollowUp = submitSessionFollowUp

  await submitSessionMessageAction(
    { current: mock() },
    'session-1',
    { text: '继续等待' },
    true,
    settings,
    mock(),
    { sessionStatus: 'waiting' },
  )

  expect(submitSessionFollowUp).toHaveBeenCalledWith(
    'session-1',
    { text: '继续等待' },
    'steer',
  )
})

test('idle session sends a normal user message', async () => {
  const submitSessionFollowUp = mock(async () => 'steered' as const)
  const sendUserMessage = mock(async () => undefined)
  desktopClient.submitSessionFollowUp = submitSessionFollowUp
  desktopClient.sendUserMessage = sendUserMessage

  await submitSessionMessageAction(
    { current: mock() },
    'session-1',
    { text: '开始修改' },
    true,
    settings,
    mock(),
    { sessionStatus: 'idle' },
  )

  expect(sendUserMessage).toHaveBeenCalled()
  expect(submitSessionFollowUp).not.toHaveBeenCalled()
})

test('follow-up override takes precedence over persisted behavior', async () => {
  const submitSessionFollowUp = mock(async () => 'steered' as const)
  desktopClient.submitSessionFollowUp = submitSessionFollowUp

  await submitSessionMessageAction(
    { current: mock() },
    'session-1',
    { text: '马上执行' },
    true,
    { ...settings, followUpBehavior: 'queue' },
    mock(),
    {
      sessionStatus: 'running',
      followUpBehavior: 'queue',
      followUpOverride: 'steer',
    },
  )

  expect(submitSessionFollowUp).toHaveBeenCalledWith(
    'session-1',
    { text: '马上执行' },
    'steer',
  )
})

test('failed submit restores the complete message input', async () => {
  const input: DesktopUserMessageInput = {
    text: '继续修改',
    attachments: [{
      id: 'attachment-1',
      name: 'note.txt',
      path: '/tmp/note.txt',
      mediaType: 'text/plain',
      sizeBytes: 12,
      kind: 'text',
      textContent: '附件内容',
      status: 'ready',
    }],
    skillInvocation: {
      name: 'review',
      skillPath: '/skills/review/SKILL.md',
    },
  }
  const restoreInput = mock()
  desktopClient.submitSessionFollowUp = mock(async () => {
    throw new Error('IPC failed')
  })

  await submitSessionMessageAction(
    { current: mock() },
    'session-1',
    input,
    true,
    settings,
    restoreInput,
    { sessionStatus: 'running' },
  )

  expect(restoreInput).toHaveBeenLastCalledWith(input)
})

test('attachment-only input submits normally', async () => {
  const sendUserMessage = mock(async () => undefined)
  desktopClient.sendUserMessage = sendUserMessage
  const input: DesktopUserMessageInput = {
    text: '',
    attachments: [{
      id: 'attachment-1',
      name: 'note.txt',
      path: '/tmp/note.txt',
      mediaType: 'text/plain',
      sizeBytes: 12,
      kind: 'text',
      textContent: '附件内容',
      status: 'ready',
    }],
  }

  await submitSessionMessageAction(
    { current: mock() },
    'session-1',
    input,
    true,
    settings,
    mock(),
    { sessionStatus: 'idle' },
  )

  expect(sendUserMessage).toHaveBeenCalledWith(
    'session-1',
    input,
    expect.any(Object),
  )
})
