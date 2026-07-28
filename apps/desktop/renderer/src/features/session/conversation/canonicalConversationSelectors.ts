import type { CanonicalThreadState } from '@codepilotx/session-view'
import type { Item } from '@codepilotx/shared/thread'

import type {
  DesktopContextUsage,
  DesktopPermissionRequest,
} from '../../../../shared/types.js'
import {
  approvalToRequest,
  latestItemContextUsage,
  questionToRequest,
  toolToRequest,
} from '../../../services/agentThreadAdapter.js'

export type SourceLink = {
  label: string
  url: string
}

export type CanonicalConversationAuxiliaryState = {
  hasConversationMessages: boolean
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
  sourceLinks: SourceLink[]
  fallbackTitle: string | null
}

const completedResultSourceLinks = new WeakMap<object, SourceLink[]>()

export function selectCanonicalConversationAuxiliaryState(
  state: CanonicalThreadState | null,
): CanonicalConversationAuxiliaryState {
  if (!state) {
    return {
      hasConversationMessages: false,
      pendingPermissions: [],
      contextUsage: null,
      sourceLinks: [],
      fallbackTitle: null,
    }
  }

  const inputs = [...state.inputsById.values()].sort(compareCreatedAt)
  const items = [...state.itemsById.values()].sort(compareCreatedAt)
  return {
    hasConversationMessages:
      inputs.length > 0 ||
      items.some(item => item.type === 'text' && item.text.trim().length > 0),
    pendingPermissions: selectPendingPermissions(state),
    contextUsage: latestItemContextUsage(items),
    sourceLinks: extractCanonicalSourceLinks(items),
    fallbackTitle: fallbackTitleFromInput(inputs[0]?.content),
  }
}

function selectPendingPermissions(
  state: CanonicalThreadState,
): DesktopPermissionRequest[] {
  const requests = new Map<
    string,
    { createdAt: number; priority: number; request: DesktopPermissionRequest }
  >()
  const add = (
    request: DesktopPermissionRequest,
    createdAt: number,
    priority: number,
  ): void => {
    const key = request.toolUseId || request.requestId
    const current = requests.get(key)
    if (!current || priority > current.priority) {
      requests.set(key, { createdAt, priority, request })
    }
  }

  for (const item of state.itemsById.values()) {
    if (item.type === 'question' && item.status === 'pending') {
      add(questionToRequest(item), item.createdAt, 2)
    } else if (item.type === 'tool' && item.state === 'waiting-permission') {
      add(toolToRequest(item), item.createdAt, 1)
    }
  }
  for (const approval of state.approvalsById.values()) {
    if (approval.status === 'pending') {
      add(approvalToRequest(approval), approval.createdAt, 3)
    }
  }

  return [...requests.values()]
    .sort((left, right) => left.createdAt - right.createdAt)
    .map(entry => entry.request)
}

function extractCanonicalSourceLinks(items: readonly Item[]): SourceLink[] {
  const byUrl = new Map<string, SourceLink>()
  for (const item of items) {
    if (
      item.type !== 'text' ||
      item.placement !== 'result' ||
      item.status !== 'completed'
    ) {
      continue
    }
    let links = completedResultSourceLinks.get(item)
    if (!links) {
      links = extractLinksFromText(item.text)
      completedResultSourceLinks.set(item, links)
    }
    for (const source of links) {
      addSourceLink(byUrl, source)
    }
  }
  return [...byUrl.values()]
}

function fallbackTitleFromInput(content: string | undefined): string | null {
  const title = content?.trim().split(/\r?\n/u)[0]
  if (!title) return null
  return title.length > 28 ? `${title.slice(0, 28)}...` : title
}

function compareCreatedAt(
  left: { createdAt: number },
  right: { createdAt: number },
): number {
  return left.createdAt - right.createdAt
}

function addSourceLink(
  byUrl: Map<string, SourceLink>,
  source: SourceLink,
): void {
  if (isLocalURL(source.url) || byUrl.has(source.url)) return
  byUrl.set(source.url, {
    label: truncateToWidth(source.label || source.url, 42),
    url: source.url,
  })
}

function extractLinksFromText(text: string): SourceLink[] {
  const links: SourceLink[] = []
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu
  for (const match of text.matchAll(markdownLinkPattern)) {
    const label = match[1]?.trim()
    const url = normalizeSourceURL(match[2] ?? '')
    if (url) links.push({ label: label || sourceLabelFromURL(url), url })
  }
  const bareUrlPattern = /https?:\/\/[^\s<>)\]]+/gu
  for (const match of text.matchAll(bareUrlPattern)) {
    const url = normalizeSourceURL(match[0] ?? '')
    if (url) links.push({ label: sourceLabelFromURL(url), url })
  }
  return links
}

function normalizeSourceURL(value: string): string | null {
  const normalized = value.trim().replace(/[.,;:!?]+$/u, '')
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    return null
  }
  try {
    return new URL(normalized).toString()
  } catch {
    return null
  }
}

function sourceLabelFromURL(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/$/u, '')
    return path ? `${parsed.hostname}${path}` : parsed.hostname
  } catch {
    return url
  }
}

function isLocalURL(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

function truncateToWidth(text: string, max: number): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(1, max - 1))}…`
}
