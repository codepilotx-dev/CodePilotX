import { z } from 'zod'
import {
  DESKTOP_API_METHODS,
  type DesktopApiMethod,
} from './ipcChannels.js'

const emptyArgs = z.tuple([])
const unknownObject = z.record(z.string(), z.unknown())
const optionalText = z.string().optional()
const nullableText = z.string().nullable()
const editableMcpScope = z.enum(['local', 'user', 'project'])
const skillCatalogOptions = z.object({
  query: optionalText,
  owner: z.enum(['all', 'official', 'community']).optional(),
  view: z.enum(['all-time', 'trending', 'hot']).optional(),
  page: z.number().int().min(0).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
})
const skillInstallInput = z.union([
  z.string(),
  z.object({
    id: z.string(),
    installUrl: z.string().nullable().optional(),
  }),
])

const providerOptions = z.object({
  providerID: z.string(),
  apiKey: optionalText,
  baseURL: optionalText,
})

const metadataPatch = z.object({
  pinnedAt: nullableText.optional(),
  archivedAt: nullableText.optional(),
})

const permissionModeSchema = z.enum([
  'default',
  'auto',
  'bypassPermissions',
  'customConfig',
  'plan',
])

const createBranchInput = z.object({
  workspacePath: z.string(),
  branchName: z.string(),
  startPoint: optionalText,
})

const commitChangesInput = z.object({
  workspacePath: z.string(),
  message: z.string(),
  paths: z.array(z.string()),
})

const pushBranchInput = z.object({
  workspacePath: z.string(),
  setUpstream: z.boolean().optional(),
  forceWithLease: z.boolean().optional(),
})

const discardWorkspaceChangesInput = z.object({
  workspacePath: z.string(),
  paths: z.array(z.string()),
  includeUntracked: z.boolean().optional(),
})

const createPullRequestInput = z.object({
  workspacePath: z.string(),
  title: z.string(),
  body: optionalText,
  draft: z.boolean().optional(),
})

const reviewScope = z.enum(['unstaged', 'staged'])

const reviewSide = z.enum(['left', 'right'])

const getWorkspaceReviewDiffInput = z.object({
  workspacePath: z.string(),
  scope: reviewScope.optional(),
})

const reviewOperationInput = z.object({
  workspacePath: z.string(),
  scope: reviewScope,
  action: z.enum(['stage', 'unstage', 'revert']),
  target: z.union([
    z.object({
      type: z.literal('file'),
      path: z.string(),
    }),
    z.object({
      type: z.literal('hunk'),
      path: z.string(),
      hunkId: z.string(),
    }),
  ]),
})

const reviewComment = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  filePath: z.string(),
  side: reviewSide,
  lineNumber: z.number().int().min(1),
  lineContent: z.string(),
  body: z.string(),
  status: z.enum(['open', 'resolved']).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

const saveSessionReviewCommentInput = z.object({
  sessionId: z.string(),
  comment: reviewComment,
})

const sessionReviewCommentInput = z.object({
  sessionId: z.string(),
  commentId: z.string(),
})

const githubRepository = z.object({
  id: z.number(),
  name: z.string(),
  fullName: z.string(),
  owner: z.string(),
  private: z.boolean(),
  fork: z.boolean(),
  archived: z.boolean(),
  disabled: z.boolean(),
  cloneUrl: z.string(),
  sshUrl: z.string(),
  htmlUrl: z.string(),
  description: z.string().nullable(),
  defaultBranch: z.string(),
  pushedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const cloneGithubRepositoryInput = z.object({
  repository: githubRepository,
})

const startGithubLoginInput = z.object({
  clientId: z.string().optional(),
})

const githubUserStatusInput = z.object({
  emoji: z.string(),
  message: z.string(),
  limitedAvailability: z.boolean(),
  expiresAt: z.string().nullable().optional(),
})

const permissionDecision = z.object({
  behavior: z.enum(['allow', 'deny']),
  message: optionalText,
  alwaysAllow: z.boolean().optional(),
  updatedInput: unknownObject.optional(),
})

const composerAttachment = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  mediaType: z.string(),
  sizeBytes: z.number(),
  kind: z.enum(['image', 'document', 'text', 'audio', 'video', 'binary']),
  status: z.enum(['ready', 'error']),
  error: optionalText,
  contentBase64: optionalText,
  previewDataUrl: optionalText,
  textContent: optionalText,
  truncated: z.boolean().optional(),
})

const userMessageInput = z.object({
  text: z.string(),
  attachments: z.array(composerAttachment).optional(),
})

export const DESKTOP_API_ARG_SCHEMAS = {
  getAuthStatus: emptyArgs,
  getRuntimeStatus: emptyArgs,
  getDesktopSettings: emptyArgs,
  saveDesktopSettings: z.tuple([unknownObject]),
  listBuiltinPlugins: emptyArgs,
  setBuiltinPluginEnabled: z.tuple([z.string(), z.boolean()]),
  listSkillsCatalog: z.tuple([skillCatalogOptions.optional()]),
  installSkill: z.tuple([skillInstallInput]),
  listSlashCommands: z.tuple([z.string().optional()]),
  listMcpServers: emptyArgs,
  saveMcpServer: z.tuple([
    z.object({
      originalName: optionalText,
      name: z.string(),
      scope: editableMcpScope,
      config: unknownObject,
    }),
  ]),
  removeMcpServer: z.tuple([z.string(), editableMcpScope]),
  setMcpServerEnabled: z.tuple([z.string(), z.boolean()]),
  listOpenTargets: emptyArgs,
  openPathWithDefaultTarget: z.tuple([z.string()]),
  listModelProviders: emptyArgs,
  getModelProviderState: emptyArgs,
  fetchProviderModels: z.tuple([providerOptions]),
  fetchProviderBalance: z.tuple([providerOptions]),
  saveModelProvider: z.tuple([
    z.object({
      providerID: z.string(),
      modelID: optionalText,
      baseURL: optionalText,
    }),
  ]),
  saveProviderApiKey: z.tuple([z.string(), z.string()]),
  deleteProviderApiKey: z.tuple([z.string()]),
  getCopilotAuthStatus: emptyArgs,
  startCopilotLogin: emptyArgs,
  pollCopilotLogin: emptyArgs,
  cancelCopilotLogin: emptyArgs,
  getGithubAuthStatus: emptyArgs,
  startGithubLogin: z.tuple([startGithubLoginInput.optional()]),
  pollGithubLogin: emptyArgs,
  logoutGithub: emptyArgs,
  listGithubRepositories: emptyArgs,
  getGithubProfileOverview: emptyArgs,
  setGithubUserStatus: z.tuple([githubUserStatusInput]),
  clearGithubUserStatus: emptyArgs,
  cloneGithubRepository: z.tuple([cloneGithubRepositoryInput]),
  chooseWorkspace: emptyArgs,
  openWorkspace: z.tuple([z.string()]),
  getWorkspaceContext: z.tuple([z.string()]),
  checkoutWorkspaceBranch: z.tuple([z.string(), z.string()]),
  getWorkspaceGitStatus: z.tuple([z.string()]),
  createWorkspaceBranch: z.tuple([createBranchInput]),
  commitWorkspaceChanges: z.tuple([commitChangesInput]),
  pushWorkspaceBranch: z.tuple([pushBranchInput]),
  discardWorkspaceChanges: z.tuple([discardWorkspaceChangesInput]),
  createPullRequest: z.tuple([createPullRequestInput]),
  getWorkspaceReviewDiff: z.tuple([getWorkspaceReviewDiffInput]),
  applyWorkspaceReviewOperation: z.tuple([reviewOperationInput]),
  listWorkspaceFiles: z.tuple([z.string()]),
  readWorkspaceFile: z.tuple([z.string(), z.string()]),
  readOptionalWorkspaceFile: z.tuple([z.string(), z.string()]),
  chooseComposerFiles: emptyArgs,
  readComposerFiles: z.tuple([z.array(z.string())]),
  getWorkspaceDiff: z.tuple([z.string()]),
  getThemeSettings: emptyArgs,
  saveThemeSettings: z.tuple([unknownObject]),
  createSession: z.tuple([unknownObject]),
  listSessions: emptyArgs,
  getSession: z.tuple([z.string()]),
  getActiveSessionId: emptyArgs,
  setActiveSession: z.tuple([z.string().nullable()]),
  updateSessionMetadata: z.tuple([z.string(), metadataPatch]),
  saveSessionReviewComment: z.tuple([saveSessionReviewCommentInput]),
  resolveSessionReviewComment: z.tuple([sessionReviewCommentInput]),
  deleteSessionReviewComment: z.tuple([sessionReviewCommentInput]),
  setSessionPermissionMode: z.tuple([z.string(), permissionModeSchema]),
  readWorkflowEventLog: emptyArgs,
  openConfigFile: emptyArgs,
  openExternalURL: z.tuple([z.string()]),
  sendUserMessage: z.tuple([z.string(), userMessageInput, optionalText]),
  respondToPermission: z.tuple([z.string(), z.string(), permissionDecision]),
  interruptSession: z.tuple([z.string()]),
  disposeSession: z.tuple([z.string()]),
  minimizeWindow: emptyArgs,
  toggleWindowMaximized: emptyArgs,
  closeWindow: emptyArgs,
  isWindowMaximized: emptyArgs,
  newWindow: emptyArgs,
  openDevTools: emptyArgs,
  openSettings: emptyArgs,
  logOut: emptyArgs,
  exitApp: emptyArgs,
  checkForUpdates: emptyArgs,
  downloadUpdate: emptyArgs,
  quitAndInstall: emptyArgs,
} as const satisfies Record<DesktopApiMethod, z.ZodTuple>

export function validateDesktopApiArgs(
  method: DesktopApiMethod,
  args: unknown[],
): unknown[] {
  return DESKTOP_API_ARG_SCHEMAS[method].parse(args)
}

export function assertDesktopApiSchemaCoverage(): void {
  const schemaMethods = new Set(Object.keys(DESKTOP_API_ARG_SCHEMAS))
  for (const method of DESKTOP_API_METHODS) {
    if (!schemaMethods.delete(method)) {
      throw new Error(`Missing desktop API arg schema: ${method}`)
    }
  }
  if (schemaMethods.size > 0) {
    throw new Error(
      `Unknown desktop API arg schema: ${[...schemaMethods].join(', ')}`,
    )
  }
}
