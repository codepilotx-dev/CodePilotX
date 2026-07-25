import {
  McpServerDeclarationSchema,
  type McpServerDeclaration,
} from "@codepilotx/agent-protocol"
import { Schema } from "effect"

type SettingsDatabase = {
  getSetting<T>(key: string): T | null
  setSetting(key: string, value: unknown): void
}

type McpOperation = {
  operationId: string
  fingerprint: string
  generation: number
}

export type McpSettingsState = {
  version: 2
  generation: number
  user: Record<string, McpServerDeclaration>
  local: Record<string, Record<string, McpServerDeclaration>>
  operations: McpOperation[]
}

const SETTINGS_KEY = "mcp.settings.v2"
const MAX_OPERATIONS = 100

const defaultState = (): McpSettingsState => ({
  version: 2,
  generation: 1,
  user: {
    context7: {
      name: "context7",
      scope: "user",
      enabled: true,
      transport: {
        type: "http",
        url: "https://mcp.context7.com/mcp",
        headerFromEnv: {
          CONTEXT7_API_KEY: "CONTEXT7_API_KEY",
        },
      },
      startupTimeoutMs: 20_000,
    },
  },
  local: {},
  operations: [],
})

const decodeDeclaration = Schema.decodeUnknownSync(McpServerDeclarationSchema, {
  onExcessProperty: "error",
})

const declarationRecord = (value: unknown): Record<string, McpServerDeclaration> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, server]) => {
      try {
        const declaration = decodeDeclaration(server)
        return key === declaration.name ? [[key, declaration] as const] : []
      } catch {
        return []
      }
    }),
  )
}

const normalizeState = (value: McpSettingsState | null): McpSettingsState => {
  if (!value || value.version !== 2) return defaultState()
  const local = value.local && typeof value.local === "object" && !Array.isArray(value.local)
    ? Object.fromEntries(
        Object.entries(value.local)
          .filter(([workspaceHash]) => /^[a-f\d]{64}$/i.test(workspaceHash))
          .map(([workspaceHash, servers]) => [workspaceHash, declarationRecord(servers)]),
      )
    : {}
  return {
    version: 2,
    generation: Number.isSafeInteger(value.generation) && value.generation >= 1 ? value.generation : 1,
    user: declarationRecord(value.user),
    local,
    operations: Array.isArray(value.operations)
      ? value.operations.filter((operation) =>
          operation
          && typeof operation.operationId === "string"
          && typeof operation.fingerprint === "string"
          && Number.isSafeInteger(operation.generation)
          && operation.generation >= 1,
        ).slice(-MAX_OPERATIONS)
      : [],
  }
}

export class McpSettingsConflictError extends Error {}

export class McpSettingsRepository {
  constructor(private readonly database: SettingsDatabase) {}

  state(): McpSettingsState {
    return normalizeState(this.database.getSetting<McpSettingsState>(SETTINGS_KEY))
  }

  mutate(input: {
    operationId: string
    fingerprint: string
    apply: (draft: McpSettingsState) => boolean
  }): { state: McpSettingsState; changed: boolean } {
    const state = this.state()
    const existing = state.operations.find((operation) => operation.operationId === input.operationId)
    if (existing) {
      if (existing.fingerprint !== input.fingerprint) {
        throw new McpSettingsConflictError("operationId 已用于其他 MCP 设置请求")
      }
      return { state: { ...state, generation: existing.generation }, changed: false }
    }

    const draft = structuredClone(state)
    const changed = input.apply(draft)
    const generation = changed ? state.generation + 1 : state.generation
    const next: McpSettingsState = {
      ...draft,
      generation,
      operations: [
        ...state.operations,
        {
          operationId: input.operationId,
          fingerprint: input.fingerprint,
          generation,
        },
      ].slice(-MAX_OPERATIONS),
    }
    this.database.setSetting(SETTINGS_KEY, next)
    return { state: next, changed }
  }
}
