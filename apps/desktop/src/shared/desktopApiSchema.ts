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

const providerOptions = z.object({
  providerID: z.string(),
  apiKey: optionalText,
  baseURL: optionalText,
})

const metadataPatch = z.object({
  pinnedAt: nullableText.optional(),
  archivedAt: nullableText.optional(),
})

const permissionDecision = z.object({
  behavior: z.enum(['allow', 'deny']),
  message: optionalText,
  alwaysAllow: z.boolean().optional(),
})

export const DESKTOP_API_ARG_SCHEMAS = {
  getAuthStatus: emptyArgs,
  getRuntimeStatus: emptyArgs,
  getDesktopSettings: emptyArgs,
  saveDesktopSettings: z.tuple([unknownObject]),
  listBuiltinPlugins: emptyArgs,
  setBuiltinPluginEnabled: z.tuple([z.string(), z.boolean()]),
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
  chooseWorkspace: emptyArgs,
  openWorkspace: z.tuple([z.string()]),
  getWorkspaceContext: z.tuple([z.string()]),
  checkoutWorkspaceBranch: z.tuple([z.string(), z.string()]),
  listWorkspaceFiles: z.tuple([z.string()]),
  readWorkspaceFile: z.tuple([z.string(), z.string()]),
  getWorkspaceDiff: z.tuple([z.string()]),
  getThemeSettings: emptyArgs,
  saveThemeSettings: z.tuple([unknownObject]),
  createSession: z.tuple([unknownObject]),
  listSessions: emptyArgs,
  getSession: z.tuple([z.string()]),
  getActiveSessionId: emptyArgs,
  setActiveSession: z.tuple([z.string().nullable()]),
  updateSessionMetadata: z.tuple([z.string(), metadataPatch]),
  openExternalURL: z.tuple([z.string()]),
  sendUserMessage: z.tuple([z.string(), z.string(), optionalText]),
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
