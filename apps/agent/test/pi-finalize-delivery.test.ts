import { describe, expect, test } from "bun:test"
import { InMemorySessionRepo } from "../scripts/support/pi-session-memory"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type Model as PiModel,
  type Models,
} from "@earendil-works/pi-ai"
import type { SubagentResult } from "../src/domain"
import { executeHarnessRun } from "../src/orchestration/pi/executeHarnessRun"
import { frozenDeferredEnvelope } from "../src/tool/ToolExecutor"
import {
  formatStructuredResult,
  parseStructuredResult,
  structuredResultDomainFields,
  structuredResultParameters,
} from "../src/orchestration/pi/structured-result"
import type {
  ActiveHarness,
  HarnessRuntimeOptions,
  HarnessRuntimeRequest,
  PiToolCompletionMetadata,
} from "../src/orchestration/pi/types"

const validResult = (summary = "完成查询工具回归并修复参数校验"): Record<string, unknown> => ({
  outcome: "succeeded",
  summary,
  findings: [{ title: "修复了校验边界", detail: "空参数不再通过", severity: "info" }],
  changedFiles: [{ path: "src/tool/tool.ts", summary: "补充校验" }],
  validation: [{ command: "bun run typecheck", status: "passed" }],
  risks: ["旧缓存需手动清理"],
  references: [{ kind: "file", value: "src/tool/tool.ts", label: "改动文件" }],
})

const validSubagentResult = (summary?: string): SubagentResult =>
  parseStructuredResult(validResult(summary))

type ToolFinishedCapture = {
  toolCallID: string
  tool: string
  result: string
  isError: boolean
  resultBlocks: unknown[]
}

async function createRuntime(input: {
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]
  lifecycle?: HarnessRuntimeOptions["lifecycle"]
  exposedTools?: readonly string[]
  onActivated?: (active: ActiveHarness) => void
}) {
  const faux = fauxProvider({
    models: [{ id: "finalize-test", input: ["text"], contextWindow: 64_000 }],
  })
  faux.setResponses(input.responses)
  const models = createModels()
  models.setProvider(faux.provider)
  const repo = new InMemorySessionRepo()
  const sessionID = crypto.randomUUID()
  const session = await repo.create({ id: sessionID })
  const finished: ToolFinishedCapture[] = []
  let active: ActiveHarness | undefined
  const runtimeOptions: HarnessRuntimeOptions = {
    activated: (_threadID, value) => {
      active = value
      input.onActivated?.(value)
    },
    harnessFactory: {
      resolve: async () => ({ models, session }),
    },
    toolExecutor: {
      deferredDefinitions: (exposure: { frozenDeferredToolNames?: readonly string[] }) => (
        frozenDeferredEnvelope([], exposure.frozenDeferredToolNames)
      ),
    } as never,
    eventSink: {
      toolFinished: async (_context, event) => {
        finished.push({
          toolCallID: event.toolCallID,
          tool: event.tool,
          result: event.result,
          isError: event.isError,
          resultBlocks: event.resultBlocks ?? [],
        })
      },
      settled: async () => undefined,
      assistantMessageCompleted: async (_context, event: { content: unknown; completion?: PiToolCompletionMetadata }) => {
        void event
      },
    },
    ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
  }
  const request: HarnessRuntimeRequest = {
    threadID: "thread-finalize-delivery",
    turnID: "turn-finalize-delivery",
    agentID: "agent-finalize-delivery",
    sessionID,
    content: "original finalize request",
    taskMode: "chat",
    permissionConfig: DEFAULT_PERMISSION_CONFIG,
    signal: new AbortController().signal,
    workspace: {} as never,
    model: faux.getModel(),
    policyModel: { providerID: "faux", id: "finalize-test" } as never,
    exposedTools: input.exposedTools ?? ["finalize_result"],
    promptSections: [{
      id: "test-system",
      role: "system",
      cache: "global-stable",
      authority: "builtin",
      source: { type: "builtin", name: "test" },
      content: "finalize delivery test",
    }],
  }
  return {
    runtime: {
      run: (value: HarnessRuntimeRequest) => executeHarnessRun(runtimeOptions, value),
      dispose: () => active?.harness.abort() ?? Promise.resolve(),
    },
    request,
    finished,
    models,
    faux,
  }
}

describe("structured result module", () => {
  test("完整结构通过解析并保持原值，空数组列表合法", () => {
    const parsed = parseStructuredResult(validResult())
    expect(parsed.outcome).toBe("succeeded")
    expect(parsed.summary).toBe("完成查询工具回归并修复参数校验")
    expect(parsed.validation[0]).toEqual({ command: "bun run typecheck", status: "passed" })
    const emptyLists = parseStructuredResult({
      outcome: "succeeded",
      summary: "没有额外内容",
      findings: [],
      changedFiles: [],
      validation: [],
      risks: [],
      references: [],
    })
    expect(emptyLists.findings).toEqual([])
  })

  test("空白或空 summary 在提交入口被拒绝", () => {
    for (const summary of ["", "   "]) {
      expect(() => parseStructuredResult(validResult(summary))).toThrow(/summary 必须是非空/)
    }
  })

  test("非法形状与非法枚举值被拒绝", () => {
    const missing = validResult()
    delete (missing as Record<string, unknown>).risks
    expect(() => parseStructuredResult(missing)).toThrow(/结构化结果参数无效/)
    const bad = validResult()
    ;(bad as Record<string, unknown>).outcome = "guessed"
    expect(() => parseStructuredResult(bad)).toThrow(/结构化结果参数无效/)
  })

  test("非法输入的错误不会回显敏感字段值", () => {
    const secret = "sk-sensitive-value"
    const bad = validResult()
    ;(bad as Record<string, unknown>).outcome = secret
    try {
      parseStructuredResult(bad)
      throw new Error("expected parseStructuredResult to reject")
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })

  test("模型可见参数 schema 覆盖共享领域全部字段", () => {
    const exposed = Object.keys(
      (structuredResultParameters as { properties?: Record<string, unknown> }).properties ?? {},
    ).sort()
    expect(exposed).toEqual(structuredResultDomainFields)
  })

  test("可读交付说明是确定性的简单格式化", () => {
    const first = formatStructuredResult(validSubagentResult())
    const second = formatStructuredResult(validSubagentResult())
    expect(first).toBe(second)
    expect(first).toContain("摘要：完成查询工具回归并修复参数校验")
    expect(first).toContain("- bun run typecheck（通过）")
    expect(first).toContain("- 旧缓存需手动清理")
    expect(first).not.toContain("findings")
  })
})

describe("finalize_result structured delivery runtime", () => {
  test("合法独立提交结束循环，不再发起收尾模型请求，输出与结果一致", async () => {
    const hostInputs: Array<{ result: SubagentResult; id: string }> = []
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(fauxToolCall("finalize_result", validResult()), { stopReason: "toolUse" }),
      ],
      lifecycle: {
        finalizeResult: async (result: SubagentResult, id: string) => {
          hostInputs.push({ result, id })
          return result
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result).toMatchObject({ status: "completed" })
    expect((result as { result?: SubagentResult }).result).toEqual(validSubagentResult())
    expect(result.output).toBe(formatStructuredResult(validSubagentResult()))
    expect(hostInputs).toHaveLength(1)
    expect(hostInputs[0]!.id).toBeTypeOf("string")
    // tool 输出沿现有链路投影为可读文本 + JSON 块
    const item = setup.finished.find((entry) => entry.tool === "finalize_result")
    expect(item).toBeDefined()
    expect(item!.isError).toBe(false)
    expect(item!.result).toBe(result.output)
    const blocks = item!.resultBlocks as Array<{ type: string; text?: string; value?: unknown }>
    expect(blocks.some((block) => block.type === "text" && block.text === result.output)).toBe(true)
    expect(blocks.some((block) => block.type === "json" && JSON.stringify(block.value) === JSON.stringify(validSubagentResult()))).toBe(true)
    await setup.runtime.dispose()
  })

  test("空白 summary 的提交返回工具错误，模型修正后可成功", async () => {
    const hostInputs: SubagentResult[] = []
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(fauxToolCall("finalize_result", validResult("   ")), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall("finalize_result", validResult()), { stopReason: "toolUse" }),
      ],
      lifecycle: {
        finalizeResult: async (result: SubagentResult) => {
          hostInputs.push(result)
          return result
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe("completed")
    expect((result as { result?: SubagentResult }).result).toEqual(validSubagentResult())
    const finished = setup.finished.filter((entry) => entry.tool === "finalize_result")
    expect(finished).toHaveLength(2)
    expect(finished[0]!.isError).toBe(true)
    expect(finished[0]!.result).toContain("summary 必须是非空")
    expect(hostInputs).toHaveLength(1)
    expect(hostInputs[0]!.summary).toBe("完成查询工具回归并修复参数校验")
    await setup.runtime.dispose()
  })

  test("宿主 callback 抛错时不保留候选、不结束循环，修正后成功", async () => {
    let calls = 0
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(fauxToolCall("finalize_result", validResult()), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall("finalize_result", validResult("第二次提交")), { stopReason: "toolUse" }),
      ],
      lifecycle: {
        finalizeResult: async (result: SubagentResult) => {
          calls += 1
          if (calls === 1) throw new Error("宿主持久化失败")
          return result
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe("completed")
    expect((result as { result?: SubagentResult }).result?.summary).toBe("第二次提交")
    const finished = setup.finished.filter((entry) => entry.tool === "finalize_result")
    expect(finished).toHaveLength(2)
    expect(finished[0]!.isError).toBe(true)
    expect(finished[0]!.result).toContain("宿主持久化失败")
    expect(finished[1]!.isError).toBe(false)
    expect(calls).toBe(2)
    await setup.runtime.dispose()
  })

  test("提交与其他工具混在同一条回复时被拒绝，其他工具正常执行且不重复", async () => {
    let updatePlanCalls = 0
    const setup = await createRuntime({
      exposedTools: ["update_plan", "finalize_result"],
      responses: [
        fauxAssistantMessage(
          [
            fauxToolCall("update_plan", {
              plan: [{ step: "检查", status: "completed" }],
            }),
            fauxToolCall("finalize_result", validResult()),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxToolCall("finalize_result", validResult()), { stopReason: "toolUse" }),
      ],
      lifecycle: {
        updatePlan: async () => {
          updatePlanCalls += 1
          return { plan: [{ step: "检查", status: "completed" }] }
        },
        finalizeResult: async (result: SubagentResult) => result,
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result.status).toBe("completed")
    expect((result as { result?: SubagentResult }).result).toEqual(validSubagentResult())
    expect(updatePlanCalls).toBe(1)
    const finalizeFinished = setup.finished.filter((entry) => entry.tool === "finalize_result")
    expect(finalizeFinished).toHaveLength(2)
    expect(finalizeFinished[0]!.isError).toBe(true)
    expect(finalizeFinished[0]!.result).toContain("唯一的工具调用")
    expect(finalizeFinished[1]!.isError).toBe(false)
    await setup.runtime.dispose()
  })

  test("提交后到来的 steering 不复用旧候选作为本次交付", async () => {
    let active: ActiveHarness | undefined
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage(fauxToolCall("finalize_result", validResult()), { stopReason: "toolUse" }),
        fauxAssistantMessage("已按补充要求说明"),
      ],
      onActivated: (value) => {
        active = value
      },
      lifecycle: {
        finalizeResult: async (result: SubagentResult) => {
          if (active) await active.harness.steer("补充要求：请解释一下结论")
          return result
        },
      },
    })
    const result = await setup.runtime.run(setup.request)
    expect(result).toEqual({ status: "completed", output: "已按补充要求说明" })
    await setup.runtime.dispose()
  })

  test("普通问答自然结束，不发起结构化结果", async () => {
    const setup = await createRuntime({
      responses: [fauxAssistantMessage("这是一个普通回答。")],
    })
    const result = await setup.runtime.run(setup.request)
    expect(result).toEqual({ status: "completed", output: "这是一个普通回答。" })
    expect(setup.finished.filter((entry) => entry.tool === "finalize_result")).toHaveLength(0)
    await setup.runtime.dispose()
  })
})
