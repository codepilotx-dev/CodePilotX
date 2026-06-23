import { desktopClient } from '../../services/desktopClient.js'
﻿import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionMetadataPatch,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopUserMessageInput,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { desktopUserMessageInputToPreviewText } from '../../../shared/desktopUserMessage.js'
import type { SessionListItem, SessionViewState } from '../../uiTypes.js'
import {
  normalizeOptionalText,
  parseAdditionalDirectories,
} from '../settings/settingsStorage.js'
import {
  applySessionView,
  createEmptySessionView,
  setSessionView,
  type SessionViewStateSetters,
  type UpdateSessionView,
} from './sessionViewState.js'

export type SessionSettingsSnapshot = {
  permissionMode: DesktopPermissionMode
  model: string
  smallFastModel: string
  fastModel: string
  defaultModel: string
  deepModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
}

export type SessionActionContext = {
  activeSessionIdRef: MutableRefObject<string | null>
  sessionViewsRef: MutableRefObject<Record<string, SessionViewState>>
  sessionWorkspacesRef: MutableRefObject<Record<string, DesktopWorkspace>>
  onErrorRef: MutableRefObject<(message: string) => void>
  viewSetters: SessionViewStateSetters
  setSessions: Dispatch<SetStateAction<SessionListItem[]>>
  setSessionId: Dispatch<SetStateAction<string | null>>
  setSessionStatus: Dispatch<SetStateAction<DesktopSessionStatus>>
}

export type CloseSessionResult = {
  nextActiveSession: SessionListItem | null
  nextWorkspace: DesktopWorkspace | null
}

export function activateSession(
  context: SessionActionContext,
  nextSessionId: string | null,
): void {
  context.activeSessionIdRef.current = nextSessionId
  context.setSessionId(nextSessionId)
  void desktopClient.setActiveSession(nextSessionId).catch(error => {
    context.onErrorRef.current(errorMessageOf(error))
  })
}

export async function createSessionForWorkspaceAction(
  context: SessionActionContext,
  settings: SessionSettingsSnapshot,
  target: DesktopWorkspace | null,
): Promise<string | null> {
  try {
    const session = await desktopClient.createSession({
      workspacePath: target?.path,
      permissionMode: settings.permissionMode,
      model: normalizeOptionalText(settings.model),
      smallFastModel: normalizeOptionalText(settings.smallFastModel),
      fastModel: normalizeOptionalText(settings.fastModel),
      defaultModel: normalizeOptionalText(settings.defaultModel),
      deepModel: normalizeOptionalText(settings.deepModel),
      sessionName: normalizeOptionalText(settings.sessionName),
      thinkingMode: settings.thinkingMode,
      systemPrompt: normalizeOptionalText(settings.systemPrompt),
      appendSystemPrompt: normalizeOptionalText(settings.appendSystemPrompt),
      additionalDirectories: parseAdditionalDirectories(
        settings.additionalDirectories,
      ),
    })
    const workspace = session.workspace
    const nextView = {
      ...(context.sessionViewsRef.current[session.sessionId] ??
        createEmptySessionView()),
      eventModelVersion: 1 as const,
    }
    context.sessionWorkspacesRef.current = {
      ...context.sessionWorkspacesRef.current,
      [session.sessionId]: workspace,
    }
    setSessionView(context.sessionViewsRef, session.sessionId, nextView)
    activateSession(context, session.sessionId)
    context.setSessionStatus('idle')
    applySessionView(nextView, context.viewSetters)
    const now = new Date()
    context.setSessions(current => [
      {
        id: session.sessionId,
        sessionName: normalizeOptionalText(settings.sessionName) ?? null,
        aiTitle: null,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
        standalone: session.standalone,
        permissionMode: settings.permissionMode,
        model: normalizeOptionalText(settings.model) ?? null,
        fallbackModel: null,
        thinkingMode: settings.thinkingMode,
        hasSystemPrompt: Boolean(normalizeOptionalText(settings.systemPrompt)),
        hasAppendSystemPrompt: Boolean(
          normalizeOptionalText(settings.appendSystemPrompt),
        ),
        additionalDirectoryCount: parseAdditionalDirectories(
          settings.additionalDirectories,
        ).length,
        status: 'idle',
        lastMessageAt: now.toISOString(),
        createdAt: now.toLocaleTimeString(),
      },
      ...current,
    ])
    return session.sessionId
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }
}

export async function submitSessionMessageAction(
  onErrorRef: MutableRefObject<(message: string) => void>,
  sessionId: string | null,
  input: DesktopUserMessageInput,
  canSubmit: boolean,
  model: string,
  setInput: (value: string) => void,
): Promise<void> {
  const trimmed = input.text.trim()
  const attachments = input.attachments ?? []
  if (!canSubmit || !sessionId) return
  setInput('')
  try {
    await desktopClient.sendUserMessage(
      sessionId,
      {
        text: trimmed,
        attachments,
      },
      normalizeOptionalText(model),
    )
  } catch (error) {
    onErrorRef.current(errorMessageOf(error))
    setInput(desktopUserMessageInputToPreviewText(input))
  }
}

export async function interruptSessionAction(
  onErrorRef: MutableRefObject<(message: string) => void>,
  sessionId: string | null,
): Promise<void> {
  if (!sessionId) return
  try {
    await desktopClient.interruptSession(sessionId)
  } catch (error) {
    onErrorRef.current(errorMessageOf(error))
  }
}

export async function decidePermissionAction(
  onErrorRef: MutableRefObject<(message: string) => void>,
  updateSessionView: UpdateSessionView,
  sessionId: string | null,
  request: DesktopPermissionRequest,
  behavior: 'allow' | 'deny',
  alwaysAllow = false,
  updatedInput?: Record<string, unknown>,
): Promise<void> {
  if (!sessionId) return
  updateSessionView(sessionId, view => ({
    ...view,
    pendingPermissions: view.pendingPermissions.filter(
      item => item.requestId !== request.requestId,
    ),
  }))
  try {
    await desktopClient.respondToPermission(sessionId, request.requestId, {
      behavior,
      message: behavior === 'deny' ? '在桌面端界面中拒绝' : undefined,
      alwaysAllow,
      updatedInput,
    })
  } catch (error) {
    onErrorRef.current(errorMessageOf(error))
  }
}

export async function closeSessionAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionId: string,
): Promise<CloseSessionResult | null> {
  try {
    await desktopClient.disposeSession(targetSessionId)
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }

  const remaining = sessions.filter(session => session.id !== targetSessionId)
  const {
    [targetSessionId]: _removedSessionView,
    ...remainingSessionViews
  } = context.sessionViewsRef.current
  const {
    [targetSessionId]: _removedWorkspace,
    ...remainingSessionWorkspaces
  } = context.sessionWorkspacesRef.current
  context.sessionViewsRef.current = remainingSessionViews
  context.sessionWorkspacesRef.current = remainingSessionWorkspaces
  context.setSessions(remaining)

  if (targetSessionId !== context.activeSessionIdRef.current) {
    return { nextActiveSession: null, nextWorkspace: null }
  }

  const next = remaining[0]
  activateSession(context, next?.id ?? null)
  context.setSessionStatus(next?.status ?? 'idle')
  if (next) {
    applySessionView(
      context.sessionViewsRef.current[next.id] ?? createEmptySessionView(),
      context.viewSetters,
    )
    const nextWorkspace = remainingSessionWorkspaces[next.id] ?? {
      name: next.workspaceName,
      path: next.workspacePath,
      isStandalone: next.standalone,
    }
    return {
      nextActiveSession: next,
      nextWorkspace: next.standalone ? null : nextWorkspace,
    }
  }
  applySessionView(createEmptySessionView(), context.viewSetters)
  return { nextActiveSession: null, nextWorkspace: null }
}

export async function updateSessionMetadataAction(
  context: SessionActionContext,
  sessions: SessionListItem[],
  targetSessionId: string,
  patch: DesktopSessionMetadataPatch,
): Promise<CloseSessionResult | null> {
  let updatedSession: SessionListItem | null = null
  try {
    const snapshot = await desktopClient.updateSessionMetadata(
      targetSessionId,
      patch,
    )
    updatedSession = snapshot.item
  } catch (error) {
    context.onErrorRef.current(errorMessageOf(error))
    return null
  }

  const updatedSessions = sessions.map(session =>
    session.id === targetSessionId ? updatedSession! : session,
  )
  context.setSessions(updatedSessions)

  const archivedActiveSession =
    targetSessionId === context.activeSessionIdRef.current &&
    updatedSession.archivedAt
  if (!archivedActiveSession) {
    return { nextActiveSession: null, nextWorkspace: null }
  }

  const next = updatedSessions.find(session => !session.archivedAt) ?? null
  activateSession(context, next?.id ?? null)
  context.setSessionStatus(next?.status ?? 'idle')
  if (next) {
    applySessionView(
      context.sessionViewsRef.current[next.id] ?? createEmptySessionView(),
      context.viewSetters,
    )
    const nextWorkspace = context.sessionWorkspacesRef.current[next.id] ?? {
      name: next.workspaceName,
      path: next.workspacePath,
      isStandalone: next.standalone,
    }
    return {
      nextActiveSession: next,
      nextWorkspace: next.standalone ? null : nextWorkspace,
    }
  }

  applySessionView(createEmptySessionView(), context.viewSetters)
  return { nextActiveSession: null, nextWorkspace: null }
}

export function selectSessionAction(
  context: SessionActionContext,
  session: SessionListItem,
): DesktopWorkspace | null {
  activateSession(context, session.id)
  context.setSessionStatus(session.status)
  applySessionView(
    context.sessionViewsRef.current[session.id] ?? createEmptySessionView(),
    context.viewSetters,
  )
  if (session.standalone) {
    return null
  }
  return context.sessionWorkspacesRef.current[session.id] ?? {
    name: session.workspaceName,
    path: session.workspacePath,
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
