import type {
  EventEnvelope,
  ProtocolCapability,
  RpcParams,
  RpcResult,
  ToolingID,
  ToolingPreference,
  ToolingStatus,
  PetCatalogResult,
  PetDescriptor,
  PetInstallPreview,
} from '@codepilotx/agent-protocol'
import type { DesktopPetOverlayBridge } from '@codepilotx/shared/desktop-pet-overlay'
import type { DesktopDataLocationIpcBridge } from '@codepilotx/shared/desktop-data-location-ipc'
import type { DesktopUpdateIpcBridge } from '@codepilotx/shared/desktop-update-ipc'
import type { DesktopTerminalIpcBridge } from '@codepilotx/shared/desktop-terminal-ipc'
import type { DesktopMicrophoneIpcBridge } from '@codepilotx/shared/desktop-microphone-ipc'
import type {
  DesktopAttachmentIpcBridge,
  DesktopAttachmentSaveInput,
  DesktopAttachmentSaveResult,
  DesktopComposerPathListInput,
  DesktopComposerPathListResult,
  DesktopComposerPathPreview,
  DesktopComposerPathReadInput,
} from '@codepilotx/shared/desktop-attachment-ipc'
import type { DesktopBrowserIpcBridge } from '@codepilotx/shared/desktop-browser-ipc'
import type { AgentRpcSubscription } from '../agentRpcClient.js'
import type {
  DesktopApi,
  DesktopComposerAttachment,
  DesktopGitStatus,
  DesktopReviewSource,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThemeSettings,
} from '../../../shared/types.js'

type DesktopClientWindow = {
  codePilotXDesktop?: {
    pickWorkspaceDirectory(): Promise<string | null>
    getAppearanceSettings?(): Promise<DesktopThemeSettings>
    saveAppearanceSettings?(settings: DesktopThemeSettings): Promise<void>
    getDesktopSettings?(): Promise<DesktopStoredSettings>
    saveDesktopSettings?(
      settings: DesktopStoredSettings,
    ): Promise<DesktopStoredSettings>
    onDesktopSettingsChange?(
      listener: (
        change:
          | DesktopStoredSettings
          | { settings: DesktopStoredSettings },
      ) => void,
    ): () => void
    copyProviderApiKey?(credentialId: string): Promise<{ clearAfterMs: 60000 }>
    getSystemTheme?(): Promise<'light' | 'dark'>
    onSystemThemeChange?(
      listener: (theme: 'light' | 'dark') => void,
    ): () => void
    listExternalOpenTargets?(targetPath: string): Promise<Array<{
      targetId: string
      label: string
      kind: 'file-explorer' | 'terminal' | 'editor'
      iconDataUrl?: string
    }>>
    openPathWithTarget?(targetPath: string, targetId: string): Promise<void>
    revealPathInFolder?(targetPath: string): Promise<void>
  } & Partial<DesktopPetOverlayBridge>
    & Partial<DesktopDataLocationIpcBridge>
    & Partial<DesktopTerminalIpcBridge>
    & Partial<DesktopUpdateIpcBridge>
    & Partial<DesktopAttachmentIpcBridge>
    & Partial<DesktopBrowserIpcBridge>
    & Partial<DesktopMicrophoneIpcBridge>
  addEventListener?: Window['addEventListener']
  removeEventListener?: Window['removeEventListener']
  dispatchEvent?: Window['dispatchEvent']
}

export type DesktopClientEnvironment = {
  window?: DesktopClientWindow
  localStorage?: Storage
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  eventSourceFactory?: (url: string) => EventSource
  openExternal?: (url: string) => void | Promise<void>
  debugBridgePort?: number
  debugBridgeToken?: string
}

export type DesktopReviewAgentFileSummary = {
  path: string
  previousPath: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'type-changed' | 'unknown'
  additions: number | null
  deletions: number | null
  changedLines: number
  changedBytes: number
  binary: boolean
  revision: string
}

export type DesktopReviewAgentSummary = {
  projectId: string
  generation: string
  source: DesktopReviewSource
  repositoryRoot: string
  headSha: string | null
  baseSha: string | null
  files: DesktopReviewAgentFileSummary[]
  totals: {
    files: number
    additions: number
    deletions: number
    changedLines: number
    changedBytes: number
  }
  largeDiffMode: boolean
}

export type DesktopReviewAgentSummaryResult = {
  snapshot: DesktopReviewAgentSummary
  cacheState: 'fresh' | 'stale'
}

export type DesktopReviewAgentFileDiff = {
  file: DesktopReviewAgentFileSummary
  revision: string
  patch: string
  hunks: Array<{
    id: string
    header: string
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patch: string
  }>
  renderable: boolean
  tooLargeReason: 'changed-lines' | 'changed-bytes' | 'line-bytes' | null
}

export type DesktopReviewAgentComment = {
  id: string
  threadId: string
  projectId: string
  sourceKey: string
  path: string
  side: 'old' | 'new'
  line: number
  hunkId: string | null
  revision: string
  body: string
  status: 'open' | 'resolved'
  githubCommentId: string | null
  githubThreadId: string | null
  createdAt: string
  updatedAt: string
}


export type DesktopAgentReviewApi = {
  getAgentReviewSummary(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    refresh?: boolean
  }): Promise<DesktopReviewAgentSummaryResult>
  getAgentReviewFileDiff(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    path: string
    hideWhitespace?: boolean
  }): Promise<DesktopReviewAgentFileDiff>
  getAgentReviewFileDiffs(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    paths: readonly string[]
    hideWhitespace?: boolean
  }): Promise<RpcResult<'review/file-diffs'>>
  applyAgentReviewOperation(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    expectedRevision: string
    action: 'stage' | 'unstage' | 'revert'
    target:
      | { kind: 'file'; path: string }
      | { kind: 'hunk'; path: string; hunkId: string }
  }): Promise<void>
  applyAgentReviewBatch(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    action: 'stage' | 'unstage' | 'revert'
    items: [
      { path: string; expectedRevision: string },
      ...Array<{ path: string; expectedRevision: string }>,
    ]
  }): Promise<RpcResult<'review/applyBatch'>>
  getAgentReviewBranches(workspacePath: string, projectId?: string): Promise<Array<{
    name: string
    sha: string
    current: boolean
    remote: boolean
  }>>
  getAgentReviewCommits(workspacePath: string, projectId?: string): Promise<Array<{
    sha: string
    shortSha: string
    subject: string
    author: string
    authoredAt: string
  }>>
  listAgentReviewComments(input: {
    projectId?: string
    workspacePath: string
    threadId: string
    sourceKey: string
  }): Promise<DesktopReviewAgentComment[]>
  saveAgentReviewComment(input: {
    projectId?: string
    id?: string
    workspacePath: string
    threadId: string
    sourceKey: string
    path: string
    side: 'old' | 'new'
    line: number
    hunkId: string | null
    revision: string
    body: string
    githubCommentId?: string
    githubThreadId?: string
  }): Promise<DesktopReviewAgentComment>
  resolveAgentReviewComment(input: {
    projectId?: string
    workspacePath: string
    threadId: string
    id: string
  }): Promise<DesktopReviewAgentComment>
  deleteAgentReviewComment(input: {
    projectId?: string
    workspacePath: string
    threadId: string
    id: string
  }): Promise<void>
  publishAgentGithubReviewComment(input: {
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>
    body: string
    path: string
    side: 'LEFT' | 'RIGHT'
    line: number
    expectedHeadRevision: string
    commitId?: string
  }): Promise<{ id: number; nodeId: string; htmlUrl: string }>
  submitAgentGithubReview(input: {
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
    expectedHeadRevision: string
    body?: string
  }): Promise<{ id: number; state: string; htmlUrl: string }>
}

export type DesktopAgentEventEnvelopeApi = {
  applyThreadPatch(
    params: Omit<RpcParams<'thread/patch/apply'>, 'operationId'>,
  ): Promise<RpcResult<'thread/patch/apply'>>
  readThreadHistoryPage(
    params: RpcParams<'thread/history/read'>,
  ): Promise<RpcResult<'thread/history/read'>>
  listPendingAgentInteractions(
    params: RpcParams<'interaction/listPending'>,
  ): Promise<RpcResult<'interaction/listPending'>>
  readThreadPatchDiff(
    params: RpcParams<'thread/patch/diff'>,
  ): Promise<RpcResult<'thread/patch/diff'>>
  subscribeAgentEventEnvelopes(
    options: AgentRpcSubscription,
    callback: (events: readonly EventEnvelope[]) => void | Promise<void>,
  ): () => void
}

export type DesktopAgentThreadTitleApi = {
  regenerateSessionTitle(
    sessionId: string,
  ): Promise<DesktopSessionSnapshot>
}

export type DesktopToolingApi = {
  listTooling(): Promise<readonly ToolingStatus[]>
  refreshTooling(): Promise<readonly ToolingStatus[]>
  setToolingPreference(
    id: ToolingID,
    preference: ToolingPreference,
  ): Promise<ToolingStatus>
  installTooling(id: ToolingID, force?: boolean): Promise<ToolingStatus>
  onToolingUpdated(callback: (status: ToolingStatus) => void): () => void
}

export type DesktopPetApi = {
  listPets(): Promise<readonly PetDescriptor[]>
  listPetCatalog(refresh?: boolean): Promise<PetCatalogResult>
  installCatalogPet(
    slug: string,
    acceptedRestrictedLicense?: boolean,
  ): Promise<PetDescriptor>
  previewPetInstall(url: string): Promise<PetInstallPreview>
  installPet(url: string): Promise<PetDescriptor>
  removePet(id: string): Promise<void>
}

export type DesktopUsageApi = {
  listUsageSources(): Promise<RpcResult<'usage/source/list'>>
  getLocalUsage(
    input: RpcParams<'usage/local/get'>,
  ): Promise<RpcResult<'usage/local/get'>>
  queryProviderUsage(
    input: RpcParams<'usage/provider/query'>,
  ): Promise<RpcResult<'usage/provider/query'>>
  connectUsageCredential(
    input: RpcParams<'usage/credential/connect'> extends infer Input
      ? Input extends unknown
        ? Omit<Input, 'operationId'>
        : never
      : never,
  ): Promise<RpcResult<'usage/credential/connect'>>
  disconnectUsageCredential(
    input: Omit<RpcParams<'usage/credential/disconnect'>, 'operationId'>,
  ): Promise<RpcResult<'usage/credential/disconnect'>>
}

export type DesktopReleaseNotesApi = {
  listReleaseNotes(options?: {
    refresh?: boolean
  }): Promise<RpcResult<'release-notes/list'>>
}

export type DesktopRuntimeCapabilityApi = {
  getRuntimeCapabilities(): Promise<readonly ProtocolCapability[]>
}

type WithoutOperationId<T> = T extends { operationId: unknown }
  ? Omit<T, 'operationId'>
  : T

export type DesktopTaskboardApi = {
  listTaskboardTasks(input: RpcParams<'taskboard/task/list'>): Promise<RpcResult<'taskboard/task/list'>>
  readTaskboardTask(input: RpcParams<'taskboard/task/read'>): Promise<RpcResult<'taskboard/task/read'>>
  createTaskboardTask(input: WithoutOperationId<RpcParams<'taskboard/task/create'>>): Promise<RpcResult<'taskboard/task/create'>>
  updateTaskboardTask(input: WithoutOperationId<RpcParams<'taskboard/task/update'>>): Promise<RpcResult<'taskboard/task/update'>>
  moveTaskboardTask(input: WithoutOperationId<RpcParams<'taskboard/task/move'>>): Promise<RpcResult<'taskboard/task/move'>>
  archiveTaskboardTask(input: WithoutOperationId<RpcParams<'taskboard/task/archive'>>): Promise<RpcResult<'taskboard/task/archive'>>
  restoreTaskboardTask(input: WithoutOperationId<RpcParams<'taskboard/task/restore'>>): Promise<RpcResult<'taskboard/task/restore'>>
  deleteTaskboardTask(input: WithoutOperationId<RpcParams<'taskboard/task/delete'>>): Promise<RpcResult<'taskboard/task/delete'>>
  linkTaskboardThread(input: WithoutOperationId<RpcParams<'taskboard/thread/link'>>): Promise<RpcResult<'taskboard/thread/link'>>
  unlinkTaskboardThread(input: WithoutOperationId<RpcParams<'taskboard/thread/unlink'>>): Promise<RpcResult<'taskboard/thread/unlink'>>
  setPrimaryTaskboardThread(input: WithoutOperationId<RpcParams<'taskboard/thread/set-primary'>>): Promise<RpcResult<'taskboard/thread/set-primary'>>
  createTaskboardComment(input: WithoutOperationId<RpcParams<'taskboard/comment/create'>>): Promise<RpcResult<'taskboard/comment/create'>>
  updateTaskboardComment(input: WithoutOperationId<RpcParams<'taskboard/comment/update'>>): Promise<RpcResult<'taskboard/comment/update'>>
  deleteTaskboardComment(input: WithoutOperationId<RpcParams<'taskboard/comment/delete'>>): Promise<RpcResult<'taskboard/comment/delete'>>
  listTaskboardLabels(input: RpcParams<'taskboard/label/list'>): Promise<RpcResult<'taskboard/label/list'>>
  createTaskboardLabel(input: WithoutOperationId<RpcParams<'taskboard/label/create'>>): Promise<RpcResult<'taskboard/label/create'>>
  updateTaskboardLabel(input: WithoutOperationId<RpcParams<'taskboard/label/update'>>): Promise<RpcResult<'taskboard/label/update'>>
  deleteTaskboardLabel(input: WithoutOperationId<RpcParams<'taskboard/label/delete'>>): Promise<RpcResult<'taskboard/label/delete'>>
  startTaskboardTask(input: WithoutOperationId<RpcParams<'taskboard/task/start'>>): Promise<RpcResult<'taskboard/task/start'>>
  readTaskboardStartStatus(input: RpcParams<'taskboard/task/start/status'>): Promise<RpcResult<'taskboard/task/start/status'>>
  retryTaskboardStartSetup(input: RpcParams<'taskboard/task/start/retry-setup'>): Promise<RpcResult<'taskboard/task/start/retry-setup'>>
  continueTaskboardStartWithoutSetup(input: RpcParams<'taskboard/task/start/continue-without-setup'>): Promise<RpcResult<'taskboard/task/start/continue-without-setup'>>
}

export type DesktopSpeechStatus = RpcResult<'speech/status'>['status']

export type DesktopSpeechApi = {
  getSpeechStatus(): Promise<DesktopSpeechStatus>
  installSpeech(force?: boolean): Promise<DesktopSpeechStatus>
  transcribeSpeech(
    input: RpcParams<'speech/transcribe'>,
  ): Promise<RpcResult<'speech/transcribe'>>
  cancelSpeech(operationId: string): Promise<boolean>
  onSpeechStatusUpdated(
    callback: (status: DesktopSpeechStatus) => void,
  ): () => void
  openMicrophonePrivacySettings(): Promise<void>
}

export type DesktopAttachmentApi = {
  isComposerFileAttachmentAvailable(): Promise<boolean>
  chooseComposerFiles(): Promise<DesktopComposerAttachment[]>
  grantComposerFilePaths(filePaths: string[]): Promise<DesktopComposerAttachment[]>
  getComposerFilePath(file: File): string
  readAttachment(
    attachmentId: string,
  ): Promise<RpcResult<'attachment/read'>>
  saveAttachmentToDownloads(
    input: DesktopAttachmentSaveInput,
  ): Promise<DesktopAttachmentSaveResult>
  readDraftComposerPath(
    input: DesktopComposerPathReadInput,
  ): Promise<DesktopComposerPathPreview>
  listDraftComposerPath(
    input: DesktopComposerPathListInput,
  ): Promise<DesktopComposerPathListResult>
}

export type DesktopLocalContextApi = {
  readLocalContextPath(
    input: RpcParams<'context/path/read'>,
  ): Promise<RpcResult<'context/path/read'>>
  listLocalContextPath(
    input: RpcParams<'context/path/list'>,
  ): Promise<RpcResult<'context/path/list'>>
}

export type CodePilotXDesktopClient = DesktopApi &
  DesktopAgentReviewApi &
  DesktopAgentEventEnvelopeApi &
  DesktopAgentThreadTitleApi &
  DesktopToolingApi &
  DesktopPetApi &
  DesktopUsageApi &
  DesktopReleaseNotesApi &
  DesktopRuntimeCapabilityApi &
  DesktopTaskboardApi &
  DesktopAttachmentApi &
  DesktopSpeechApi &
  DesktopLocalContextApi
