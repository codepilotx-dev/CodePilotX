import type {
  DesktopPetSettings,
  DesktopPermissionRequest,
  DesktopSessionStatus,
  DesktopSessionSnapshot,
} from '../../../shared/types.js'

export type PetNotificationKind =
  | 'approval'
  | 'question'
  | 'plan'
  | 'exec'
  | 'network'
  | 'tool'
  | 'completed'
  | 'failed'

export type PetNotification = {
  id: string
  threadId: string
  requestId?: string
  request?: DesktopPermissionRequest
  kind: PetNotificationKind
  title: string
  detail?: string
  createdAt: number
  expiresAt: number | null
  priority: number
}

export type PetProjectionInput = {
  previous: readonly DesktopSessionSnapshot[]
  current: readonly DesktopSessionSnapshot[]
  now: number
  dismissedIds: ReadonlySet<string>
  preferences: DesktopPetSettings
}

export function resolvePetReplyDelivery(
  status: DesktopSessionStatus | undefined,
  hasPendingRequest: boolean,
): 'follow-up' | 'message' {
  return hasPendingRequest
    || status === 'running'
    || status === 'waiting'
    || status === 'queued'
    ? 'follow-up'
    : 'message'
}

export function projectPetNotifications({
  previous,
  current,
  now,
  dismissedIds,
  preferences,
}: PetProjectionInput): PetNotification[] {
  const previousById = new Map(
    previous.map(snapshot => [snapshot.item.id, snapshot]),
  )
  const notifications: PetNotification[] = []

  for (const snapshot of current) {
    if (
      snapshot.item.archivedAt
      || snapshot.item.source === 'internal_guardian'
    ) {
      continue
    }
    const threadId = snapshot.item.id
    const title =
      snapshot.item.customTitle
      || snapshot.item.aiTitle
      || snapshot.item.sessionName
      || snapshot.item.firstPrompt
      || '未命名任务'

    if (preferences.notifyAttention) {
      for (const request of snapshot.view.pendingPermissions) {
        const notification = blockerNotification(
          threadId,
          title,
          request,
          now,
        )
        if (!dismissedIds.has(notification.id)) notifications.push(notification)
      }
    }

    const previousStatus = previousById.get(threadId)?.item.status
    const status = snapshot.item.status
    if (
      preferences.notifyCompletion
      && previousStatus
      && previousStatus !== 'done'
      && status === 'done'
    ) {
      const createdAt = parseTime(snapshot.updatedAt, now)
      const notification: PetNotification = {
        id: `${threadId}:completed:${snapshot.updatedAt}`,
        threadId,
        kind: 'completed',
        title: '任务已完成',
        detail: title,
        createdAt,
        expiresAt: createdAt + 15_000,
        priority: 40,
      }
      if (!dismissedIds.has(notification.id)) notifications.push(notification)
    }
    if (
      preferences.notifyFailure
      && previousStatus
      && previousStatus !== 'error'
      && status === 'error'
    ) {
      const createdAt = parseTime(snapshot.updatedAt, now)
      const notification: PetNotification = {
        id: `${threadId}:failed:${snapshot.updatedAt}`,
        threadId,
        kind: 'failed',
        title: '任务需要检查',
        detail: title,
        createdAt,
        expiresAt: createdAt + 30_000,
        priority: 80,
      }
      if (!dismissedIds.has(notification.id)) notifications.push(notification)
    }
  }

  return notifications
    .filter(item => item.expiresAt === null || item.expiresAt > now)
    .sort(
      (left, right) =>
        right.priority - left.priority
        || left.createdAt - right.createdAt
        || left.id.localeCompare(right.id),
    )
}

function blockerNotification(
  threadId: string,
  threadTitle: string,
  request: DesktopPermissionRequest,
  now: number,
): PetNotification {
  const kind = blockerKind(request)
  const label = {
    approval: '等待你的批准',
    question: '有一个问题',
    plan: '计划等待确认',
    exec: '命令等待批准',
    network: '联网请求等待批准',
    tool: '工具调用等待批准',
  }[kind]
  return {
    id: `${threadId}:${request.requestId}`,
    threadId,
    requestId: request.requestId,
    request,
    kind,
    title: label,
    detail: request.description || threadTitle,
    createdAt: now,
    expiresAt: null,
    priority: kind === 'question' || kind === 'plan' ? 100 : 90,
  }
}

function blockerKind(
  request: DesktopPermissionRequest,
): Exclude<PetNotificationKind, 'completed' | 'failed'> {
  if (request.toolName === 'AskUserQuestion') return 'question'
  if (request.toolName === 'ExitPlanMode') return 'plan'
  if (request.requestKind === 'network') return 'network'
  if (request.requestKind === 'shell-command') return 'exec'
  if (request.requestKind === 'tool') return 'tool'
  return 'approval'
}

function parseTime(value: string, fallback: number): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : fallback
}
