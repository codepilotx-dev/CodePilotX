import type {
  CreateSessionResponse,
  ModelRef,
  PermissionReply,
  ProvidersResponse,
  ProviderSetting,
  Proposal as SharedProposal,
  QuestionReply,
  ServerEvent,
  SessionSnapshot,
  SubmitMessage,
  SubmitMessageResponse,
} from '@codepilotx/shared'

export interface ProjectSettings {
  defaultModel: ModelRef | null
  plannerModel: ModelRef | null
  developerModel: ModelRef | null
  reviewerModel: ModelRef | null
}

export interface ProjectInfo {
  id: string
  name: string
  rootPath: string
  lastOpenedAt: number
  settings?: ProjectSettings
}

export interface Proposal {
  id: string
  runID: string
  type: 'patch' | 'command'
  path?: string
  before?: string
  after?: string
  command?: string
  cwd?: string
  reason?: string
  review?: string | null
  status: 'pending' | 'reviewed' | 'rejected'
  createdAt: number
}

export class AgentApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'AgentApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    throw new AgentApiError(body?.error?.message ?? `请求失败 (${response.status})`, response.status, body?.error?.code)
  }
  return response.json() as Promise<T>
}

export const agentApi = {
  createSession(title = '新对话', projectID?: string) {
    return request<CreateSessionResponse>('/api/sessions', { method: 'POST', body: JSON.stringify({ title, projectID }) })
  },
  getSession(sessionID: string) {
    return request<SessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionID)}`)
  },
  submitMessage(sessionID: string, payload: SubmitMessage) {
    return request<SubmitMessageResponse>(`/api/sessions/${encodeURIComponent(sessionID)}/messages`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  },
  stop(sessionID: string) {
    return request<{ ok: true }>(`/api/sessions/${encodeURIComponent(sessionID)}/stop`, { method: 'POST', body: '{}' })
  },
  replyPermission(permissionID: string, decision: PermissionReply['decision']) {
    return request<{ ok: true }>(`/api/permissions/${encodeURIComponent(permissionID)}/reply`, {
      method: 'POST', body: JSON.stringify({ decision }),
    })
  },
  replyQuestion(questionID: string, answer: string, ignored = false) {
    const payload: QuestionReply = { answer, ignored }
    return request<{ ok: true }>(`/api/questions/${encodeURIComponent(questionID)}/reply`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  },
  planDecision(runID: string, decision: 'continue' | 'reject') {
    return request<{ ok: true }>(`/api/runs/${encodeURIComponent(runID)}/plan-decision`, {
      method: 'POST', body: JSON.stringify({ decision }),
    })
  },
  providers() {
    return request<ProvidersResponse>('/api/providers')
  },
  saveCredential(providerID: string, apiKey: string) {
    return request<{ ok: true }>(`/api/providers/${encodeURIComponent(providerID)}/credential`, {
      method: 'PUT', body: JSON.stringify({ apiKey }),
    })
  },
  deleteCredential(providerID: string) {
    return request<{ ok: true }>(`/api/providers/${encodeURIComponent(providerID)}/credential`, { method: 'DELETE' })
  },
  saveProvider(setting: ProviderSetting) {
    return request<{ ok: true }>(`/api/providers/${encodeURIComponent(setting.providerID)}/settings`, {
      method: 'PUT', body: JSON.stringify({ setting }),
    })
  },
  refreshModels() {
    return request<ProvidersResponse>('/api/models/refresh', { method: 'POST', body: '{}' })
  },
  setDefaultModel(model: ModelRef) {
    return request<{ ok: true }>('/api/settings/default-model', { method: 'PUT', body: JSON.stringify(model) })
  },
  setReviewerModel(model: ModelRef | null) {
    return request<{ ok: true }>('/api/settings/reviewer-model', {
      method: 'PUT', body: JSON.stringify(model ?? { providerID: null, modelID: null }),
    })
  },
  projects() {
    return request<{ projects: ProjectInfo[] }>('/api/projects').then((response) => response.projects)
  },
  createProject(input: { rootPath: string; name?: string }) {
    return request<{ project: ProjectInfo }>('/api/projects', { method: 'POST', body: JSON.stringify(input) }).then((response) => response.project)
  },
  selectProject(projectID: string) {
    return request<{ project: ProjectInfo }>(`/api/projects/${encodeURIComponent(projectID)}/select`, { method: 'POST', body: '{}' }).then((response) => response.project)
  },
  projectSettings(projectID: string) {
    return request<{ settings: ProjectSettings }>(`/api/projects/${encodeURIComponent(projectID)}/settings`).then((response) => response.settings)
  },
  saveProjectSettings(projectID: string, settings: ProjectSettings) {
    return request<{ settings: ProjectSettings }>(`/api/projects/${encodeURIComponent(projectID)}/settings`, { method: 'PUT', body: JSON.stringify({ settings }) }).then((response) => response.settings)
  },
  proposals(sessionID: string) {
    return request<{ proposals: SharedProposal[] }>(`/api/sessions/${encodeURIComponent(sessionID)}/proposals`).then((response) => response.proposals.map(toProposal))
  },
  reviewProposal(proposalID: string, status: 'reviewed' | 'rejected') {
    return request<{ proposal: SharedProposal }>(`/api/proposals/${encodeURIComponent(proposalID)}/review`, { method: 'POST', body: JSON.stringify({ status }) }).then((response) => toProposal(response.proposal))
  },
}

export function subscribeToSession(
  sessionID: string,
  after: number,
  onEvent: (event: ServerEvent) => void,
  onConnectionChange: (connected: boolean) => void,
) {
  const source = new EventSource(`/api/events?sessionID=${encodeURIComponent(sessionID)}&after=${after}`, { withCredentials: true })
  source.onopen = () => onConnectionChange(true)
  source.onerror = () => onConnectionChange(false)
  source.onmessage = (message) => {
    try { onEvent(JSON.parse(message.data) as ServerEvent) } catch { /* ignore invalid transport frames */ }
  }
  return () => source.close()
}

export function modelRefKey(ref: ModelRef) {
  return `${ref.providerID}/${ref.modelID}`
}

function toProposal(proposal: SharedProposal): Proposal {
  const payload = proposal.payload && typeof proposal.payload === 'object' && !Array.isArray(proposal.payload)
    ? proposal.payload as Record<string, unknown>
    : {}
  return {
    id: proposal.id,
    runID: proposal.runID,
    type: proposal.kind,
    ...(typeof payload.path === 'string' ? { path: payload.path } : {}),
    ...(typeof payload.before === 'string' ? { before: payload.before } : {}),
    ...(typeof payload.after === 'string' ? { after: payload.after } : {}),
    ...(typeof payload.command === 'string' ? { command: payload.command } : {}),
    ...(typeof payload.cwd === 'string' ? { cwd: payload.cwd } : {}),
    ...(typeof payload.description === 'string' ? { reason: payload.description } : {}),
    review: proposal.review,
    status: proposal.status,
    createdAt: proposal.createdAt,
  }
}
