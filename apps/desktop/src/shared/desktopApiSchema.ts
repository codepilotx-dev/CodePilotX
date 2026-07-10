import { z } from 'zod'
import { DESKTOP_AGENT_PERMISSION_MODES } from '@codepilotx/core/agent/permissions.js'
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

const modelSelection = z.object({
  providerID: optionalText,
  providerBaseURL: optionalText,
  model: optionalText,
  debugConversationDump: z.boolean().optional(),
  localRouterMode: z.enum(['off', 'pareto-code', 'fusion']).optional(),
})

const metadataPatch = z.object({
  pinnedAt: nullableText.optional(),
  archivedAt: nullableText.optional(),
})

const browserBounds = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
})

const permissionModeSchema = z.enum(DESKTOP_AGENT_PERMISSION_MODES)

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

const restoreSessionTurnChangesInput = z.object({
  sessionId: z.string(),
  turnRestoreId: z.string(),
  paths: z.array(z.string()),
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
  planExecutionModel: optionalText,
  planExecutionProviderID: optionalText,
  planExecutionProviderBaseURL: optionalText,
  savePlanExecutionModel: z.boolean().optional(),
  rememberOptionId: z.enum(['session', 'persistentPrefix']).optional(),
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

const memoryPathInput = z.object({
  workspacePath: z.string(),
  relativePath: z.string(),
})

const saveProjectMemoryInput = memoryPathInput.extend({
  content: z.string(),
})

const resetProjectMemoryInput = z.object({
  workspacePath: z.string(),
  includeRecallLog: z.boolean(),
})

const userMemoryPathInput = z.object({
  relativePath: z.string(),
})

const saveUserMemoryInput = userMemoryPathInput.extend({
  content: z.string(),
})

const resetUserMemoryInput = z.object({
  includeEventLog: z.boolean(),
})

const importUserMemoryInput = z.object({
  files: z.array(z.object({
    relativePath: z.string(),
    content: z.string(),
  })),
})

export const DESKTOP_API_ARG_SCHEMAS = {
  getAuthStatus: emptyArgs,
  getRuntimeStatus: emptyArgs,
  diagnoseDesktopToolchain: emptyArgs,
  reinstallDesktopToolchain: emptyArgs,
  deleteDesktopToolchain: emptyArgs,
  getDesktopSettings: emptyArgs,
  saveDesktopSettings: z.tuple([unknownObject]),
  listProjectMemories: z.tuple([z.string()]),
  readProjectMemory: z.tuple([z.string(), z.string()]),
  saveProjectMemory: z.tuple([saveProjectMemoryInput]),
  deleteProjectMemory: z.tuple([memoryPathInput]),
  resetProjectMemory: z.tuple([resetProjectMemoryInput]),
  listProjectMemoryRecalls: z.tuple([z.string()]),
  listUserMemories: emptyArgs,
  readUserMemory: z.tuple([z.string()]),
  saveUserMemory: z.tuple([saveUserMemoryInput]),
  deleteUserMemory: z.tuple([userMemoryPathInput]),
  resetUserMemory: z.tuple([resetUserMemoryInput]),
  exportUserMemory: emptyArgs,
  importUserMemory: z.tuple([importUserMemoryInput]),
  getBrowserState: emptyArgs,
  openBrowser: z.tuple([z.string().optional()]),
  navigateBrowser: z.tuple([z.string()]),
  reloadBrowser: emptyArgs,
  goBackBrowser: emptyArgs,
  goForwardBrowser: emptyArgs,
  closeBrowser: emptyArgs,
  setBrowserBounds: z.tuple([browserBounds]),
  clearBrowserAllowedSites: emptyArgs,
  listBuiltinPlugins: emptyArgs,
  setBuiltinPluginEnabled: z.tuple([z.string(), z.boolean()]),
  listSkillsCatalog: z.tuple([skillCatalogOptions.optional()]),
  installSkill: z.tuple([skillInstallInput]),
  listSlashCommands: z.tuple([z.string().optional()]),
  listMcpServers: emptyArgs,
  getMcpRuntimeStatus: z.tuple([z.string().optional()]),
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
  reloadMcpConfiguration: emptyArgs,
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
  restoreSessionTurnChanges: z.tuple([restoreSessionTurnChangesInput]),
  createPullRequest: z.tuple([createPullRequestInput]),
  getWorkspaceReviewDiff: z.tuple([getWorkspaceReviewDiffInput]),
  applyWorkspaceReviewOperation: z.tuple([reviewOperationInput]),
  listWorkspaceFiles: z.tuple([z.string()]),
  readWorkspaceFile: z.tuple([z.string(), z.string()]),
  readOptionalWorkspaceFile: z.tuple([z.string(), z.string()]),
  chooseComposerFiles: emptyArgs,
  authorizeComposerFilePaths: z.tuple([z.array(z.string())]),
  readComposerFiles: z.tuple([z.array(z.string())]),
  getWorkspaceDiff: z.tuple([z.string()]),
  getThemeSettings: emptyArgs,
  saveThemeSettings: z.tuple([unknownObject]),
  createSession: z.tuple([unknownObject]),
  listSessions: z.tuple([
    z.object({ archived: z.boolean().optional() }).optional(),
  ]),
  getSessionCatalogStatus: emptyArgs,
  getSession: z.tuple([z.string()]),
  getActiveSessionId: emptyArgs,
  setActiveSession: z.tuple([z.string().nullable()]),
  updateSessionMetadata: z.tuple([z.string(), metadataPatch]),
  renameSession: z.tuple([z.string(), z.string().min(1)]),
  saveSessionReviewComment: z.tuple([saveSessionReviewCommentInput]),
  resolveSessionReviewComment: z.tuple([sessionReviewCommentInput]),
  deleteSessionReviewComment: z.tuple([sessionReviewCommentInput]),
  setSessionPermissionMode: z.tuple([z.string(), permissionModeSchema]),
  setSessionPlanModeActive: z.tuple([z.string(), z.boolean()]),
  setSessionLocalRouterMode: z.tuple([
    z.string(),
    z.enum(['off', 'pareto-code', 'fusion']),
  ]),
  readWorkflowEventLog: emptyArgs,
  openConfigFile: emptyArgs,
  openExternalURL: z.tuple([z.string()]),
  sendUserMessage: z.tuple([
    z.string(),
    userMessageInput,
    z.union([optionalText, modelSelection]).optional(),
  ]),
  respondToPermission: z.tuple([z.string(), z.string(), permissionDecision]),
  interruptSession: z.tuple([z.string()]),
  disposeSession: z.tuple([z.string()]),
  minimizeWindow: emptyArgs,
  toggleWindowMaximized: emptyArgs,
  closeWindow: emptyArgs,
  isWindowMaximized: emptyArgs,
  newWindow: emptyArgs,
  openDevTools: emptyArgs,
  closeDevTools: emptyArgs,
  openSettings: emptyArgs,
  logOut: emptyArgs,
  exitApp: emptyArgs,
  getDataLocation: emptyArgs,
  chooseDataLocation: emptyArgs,
  checkForUpdates: emptyArgs,
  downloadUpdate: emptyArgs,
  quitAndInstall: emptyArgs,
  listDebugBuiltinTools: emptyArgs,
  runDebugToolProbe: z.tuple([z.enum(['safe', 'realManual', 'realAuto'])]),
  cancelDebugToolProbe: z.tuple([z.string()]),
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
