/**
 * System Service Contract 框架。
 *
 * System/Profile 插件通过替换固定业务 service provider 改变 Agent 行为。
 * 每个业务服务定义一个稳定契约：
 * - key 使用 `codepilotx.<service>@<major>`；
 * - methods 的 input/output 必须是 JSON Schema 可表达数据；
 * - 具体业务契约（model-runtime、tool-runtime、permission-policy、
 *   agent-loop、session-persistence 等）在各自落地 PR 中定义并注册，
 *   本文件只提供契约的类型框架与注册表。
 */

import type { JsonSchema } from "../json-schema"

export type SystemServiceKey = `codepilotx.${string}@${number}`

export const SYSTEM_SERVICE_KEY_PATTERN = /^codepilotx\.[a-z][a-z0-9-]*@\d+$/

export interface SystemServiceMethod {
  /** 方法名（小驼峰）。 */
  name: string
  input: JsonSchema
  output: JsonSchema
  description?: string
}

export interface SystemServiceContract {
  key: SystemServiceKey
  /** 契约实现版本（严格 SemVer）；major 必须与 key 中 @major 一致。 */
  version: string
  description: string
  methods: readonly SystemServiceMethod[]
  /** 是否 singleton（只允许一个 provider 被选中）。 */
  singleton: boolean
}

export function isSystemServiceKey(value: unknown): value is SystemServiceKey {
  return typeof value === "string" && SYSTEM_SERVICE_KEY_PATTERN.test(value)
}

/** 契约注册表：固定业务服务的唯一登记入口（composition root 使用）。 */
export class SystemServiceContractRegistry {
  private readonly contracts = new Map<SystemServiceKey, SystemServiceContract>()

  register(contract: SystemServiceContract): void {
    if (!isSystemServiceKey(contract.key)) {
      throw new Error(`非法 System service key：${String(contract.key)}`)
    }
    if (this.contracts.has(contract.key)) {
      throw new Error(`System service 契约重复注册：${contract.key}`)
    }
    const expectedMajor = contract.key.split("@")[1]
    if (contract.version.split(".")[0] !== expectedMajor) {
      throw new Error(`System service 契约版本 major 与 key 不符：${contract.key}`)
    }
    this.contracts.set(contract.key, Object.freeze(contract))
  }

  get(key: SystemServiceKey): SystemServiceContract | undefined {
    return this.contracts.get(key)
  }

  list(): readonly SystemServiceContract[] {
    return [...this.contracts.values()]
  }
}

/** 便捷定义器：返回冻结契约。 */
export function defineSystemServiceContract(input: SystemServiceContract): SystemServiceContract {
  if (!isSystemServiceKey(input.key)) throw new Error(`非法 System service key：${String(input.key)}`)
  if (input.methods.length === 0) throw new Error(`System service 契约至少需要一个方法：${input.key}`)
  const seen = new Set<string>()
  for (const method of input.methods) {
    if (seen.has(method.name)) throw new Error(`System service 契约方法重复：${input.key}#${method.name}`)
    seen.add(method.name)
  }
  return Object.freeze(input)
}

// ── 固定业务契约（PR 8 各子 PR 落地；输出形状与 thread-rpc-v4 对齐） ─────

/** 模型目录与解析 facade（默认实现：Pi catalog/runtime 包装）。 */
export const MODEL_RUNTIME_CONTRACT = defineSystemServiceContract({
  key: "codepilotx.model-runtime@1",
  version: "1.0.0",
  description: "模型目录与解析 facade；凭据始终通过既有 credential 流程，Provider 不取得原始凭据仓库。",
  singleton: true,
  methods: [
    {
      name: "listCatalog",
      description: "返回与 v4 model/list 对齐的模型目录（providers/models/defaultModel）。",
      input: { type: "object", additionalProperties: false, properties: {} },
      output: { type: "object", description: "与 RpcResult<'model/list'> 对齐的数据形状" },
    },
    {
      name: "resolveModel",
      description: "按 Model.Ref 解析模型可用性（失败抛安全错误）。",
      input: { type: "object", properties: { providerID: { type: "string" }, id: { type: "string" } }, required: ["providerID", "id"] },
      output: { type: "object", description: "解析后的模型信息" },
    },
  ],
})

/** 工具目录 facade（默认实现：ToolPipeline/ToolCatalog 包装）。 */
export const TOOL_RUNTIME_CONTRACT = defineSystemServiceContract({
  key: "codepilotx.tool-runtime@1",
  version: "1.0.0",
  description: "工具目录 facade；工具执行仍走统一 ToolExecutor 权限链。",
  singleton: true,
  methods: [
    {
      name: "listTools",
      description: "返回当前注册工具目录（sdkName/inputSchema/描述）。",
      input: { type: "object", additionalProperties: false, properties: {} },
      output: { type: "object", description: "与 ToolCatalog.list 对齐的目录数据" },
    },
  ],
})

/** 整轮 Agent 编排替换点（默认实现：Pi orchestration 原路径，不包装）。 */
export const AGENT_LOOP_CONTRACT = defineSystemServiceContract({
  key: "codepilotx.agent-loop@1",
  version: "1.0.0",
  description: "整轮 Agent 编排替换点。固定输入：thread/turn 身份、模型选择、权限上下文、事件发布；固定输出：完成/错误分类、usage 与中断状态。",
  singleton: true,
  methods: [
    {
      name: "runTurn",
      description: "执行一整轮 Agent turn；Host 负责把输出映射回既有 AgentRuntimeResult 与事件流。",
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadID: { type: "string" },
          turnID: { type: "string" },
          agentID: { type: "string" },
          sessionID: { type: "string" },
          profile: { type: "string" },
          content: { type: "string" },
          taskMode: { type: "string", enum: ["chat", "plan"] },
          model: {
            type: "object",
            properties: { providerID: { type: "string" }, id: { type: "string" } },
            required: ["providerID", "id"],
            additionalProperties: false,
          },
          permissionConfig: { type: "object" },
          resume: { type: "object" },
          aborted: { type: "boolean" },
        },
        required: ["threadID", "turnID", "agentID", "sessionID", "content", "taskMode", "model", "permissionConfig", "aborted"],
      },
      output: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["completed", "paused", "error", "interrupted"] },
          output: { type: "string" },
          result: { type: "object", description: "SubagentResult 形状（仅 completed 时可选）" },
          error: {
            type: "object",
            properties: { code: { type: "string" }, message: { type: "string" } },
            required: ["code", "message"],
          },
          usage: {
            type: "object",
            properties: {
              inputTokens: { type: "number" },
              outputTokens: { type: "number" },
              totalTokens: { type: "number" },
              requests: { type: "number" },
            },
          },
          events: {
            type: "array",
            items: {
              type: "object",
              properties: { method: { type: "string" }, params: { type: "object" } },
              required: ["method"],
            },
            description: "Provider 要求 Host 发布的事件（Host 侧发布，Provider 不直接发事件）。",
          },
        },
        required: ["status", "output"],
      },
    },
  ],
})

/**
 * 会话持久化替换点（默认实现：现有 SQLite/AgentDatabase 原路径，不包装）。
 *
 * Provider 只能在自己的 namespaced 数据根内读写，不得触碰默认
 * AgentDatabase / profile / history 文件；staging 前必须通过
 * `runSessionPersistenceConformance`（见 testing/）。
 */
export const SESSION_PERSISTENCE_CONTRACT = defineSystemServiceContract({
  key: "codepilotx.session-persistence@1",
  version: "1.0.0",
  description: "会话事件存储替换点。固定操作：open/append/transaction/flush/replay/cursor/checkpoint/recovery/shutdown；Provider 使用独立 namespaced 数据根，不能触碰默认 AgentDatabase。",
  singleton: true,
  methods: [
    {
      name: "open",
      description: "打开（或重新打开）namespaced 数据根；重复 open 幂等（重启后重新加载）。",
      input: {
        type: "object",
        properties: { dataRoot: { type: "string" } },
        required: ["dataRoot"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    },
    {
      name: "append",
      description: "追加一条或多条持久化条目；返回新游标（严格单调递增）。",
      input: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string" },
                payload: { type: "object" },
              },
              required: ["id", "type", "payload"],
            },
          },
        },
        required: ["entries"],
      },
      output: {
        type: "object",
        properties: { cursor: { type: "number" } },
        required: ["cursor"],
      },
    },
    {
      name: "transaction",
      description: "原子追加一批条目：要么全部可见，要么全部不可见。",
      input: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string" },
                payload: { type: "object" },
              },
              required: ["id", "type", "payload"],
            },
          },
        },
        required: ["entries"],
      },
      output: {
        type: "object",
        properties: { cursor: { type: "number" } },
        required: ["cursor"],
      },
    },
    {
      name: "flush",
      description: "把已追加的条目强制落盘（完成后崩溃不得丢失）。",
      input: { type: "object", additionalProperties: false, properties: {} },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    },
    {
      name: "replay",
      description: "从 afterCursor 之后重放条目（limit 可选，0/缺省 = 全部剩余）。",
      input: {
        type: "object",
        properties: {
          afterCursor: { type: "number" },
          limit: { type: "number" },
        },
        required: ["afterCursor"],
      },
      output: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string" },
                payload: { type: "object" },
                cursor: { type: "number" },
              },
            },
          },
          cursor: { type: "number" },
        },
        required: ["entries", "cursor"],
      },
    },
    {
      name: "cursor",
      description: "返回当前游标（已落盘条目的最大序号）。",
      input: { type: "object", additionalProperties: false, properties: {} },
      output: {
        type: "object",
        properties: { cursor: { type: "number" } },
        required: ["cursor"],
      },
    },
    {
      name: "checkpoint",
      description: "保存或读取一个命名 checkpoint（跨重启保留）。",
      input: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "load"] },
          key: { type: "string" },
          value: { type: "object" },
        },
        required: ["action", "key"],
      },
      output: {
        type: "object",
        properties: {
          value: {
            oneOf: [{ type: "object" }, { type: "null" }],
            description: "load 结果；缺失 key 时返回 null",
          },
        },
      },
    },
    {
      name: "recovery",
      description: "中断恢复：清理未完成的半写状态，返回恢复的条目数（≥0）。",
      input: { type: "object", additionalProperties: false, properties: {} },
      output: {
        type: "object",
        properties: { recovered: { type: "number" } },
        required: ["recovered"],
      },
    },
    {
      name: "shutdown",
      description: "关闭存储（幂等）；之后再次 open 可重新加载。",
      input: { type: "object", additionalProperties: false, properties: {} },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    },
  ],
})

/** 审批策略 facade（默认实现：PermissionDecisionEngine 包装）。 */
export const PERMISSION_POLICY_CONTRACT = defineSystemServiceContract({  key: "codepilotx.permission-policy@1",
  version: "1.0.0",
  description: "工具调用审批决策；自定义 Provider 可以改变策略，但 v4 approval checkpoint shape 固定。",
  singleton: true,
  methods: [
    {
      name: "decide",
      description: "对一次工具调用返回 allow/review/deny；映射回既有 approval checkpoint。",
      input: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          input: { type: "object" },
          taskMode: { type: "string", enum: ["chat", "plan"] },
          permissionConfig: { type: "object" },
        },
        required: ["toolName", "taskMode"],
      },
      output: {
        type: "object",
        properties: {
          decision: { type: "string", enum: ["allow", "review", "deny"] },
          reason: { type: "string" },
        },
        required: ["decision"],
      },
    },
  ],
})
