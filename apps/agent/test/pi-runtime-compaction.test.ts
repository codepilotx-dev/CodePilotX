import { describe, expect, test } from "bun:test"
import { InMemorySessionRepo } from "@codepilotx/pi-agent-core"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Context,
} from "@earendil-works/pi-ai"
import { AgentError } from "../src/domain"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { PiAgentRuntime } from "../src/orchestration/pi/PiAgentRuntime"
import { REACTIVE_CONTINUATION_PROMPT } from "../src/orchestration/pi/ContextOverflow"
import type {
  PiRuntimeRequest,
  RuntimeCompactionTrigger,
} from "../src/orchestration/pi/types"

const providerError = () => fauxAssistantMessage([], {
  stopReason: "error",
  errorMessage: "context_length_exceeded: maximum context length reached",
})

const messageText = (message: Context["messages"][number]) => {
  if (message.role !== "user") return ""
  if (typeof message.content === "string") return message.content
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

async function createRuntime(input: {
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]
  shouldAutoCompact?: boolean
}) {
  const faux = fauxProvider({
    models: [{ id: "runtime-compaction", input: ["text"], contextWindow: 64_000 }],
  })
  faux.setResponses(input.responses)
  const models = createModels()
  models.setProvider(faux.provider)
  const repo = new InMemorySessionRepo()
  const sessionID = crypto.randomUUID()
  const session = await repo.create({ id: sessionID })
  const compacted: RuntimeCompactionTrigger[] = []
  const failures: RuntimeCompactionTrigger[] = []
  const runtime = new PiAgentRuntime({
    harnessFactory: {
      resolve: async () => ({ models, session }),
    },
    toolExecutor: {
      deferredDefinitions: () => [],
      baseCatalog: () => new ToolRegistry(),
    } as never,
    eventHandler: async (event) => {
      if (event.type === "compaction.completed") compacted.push(event.trigger)
    },
    compaction: {
      shouldAutoCompact: async () => input.shouldAutoCompact ?? false,
      recordFailure: async (_threadID, trigger) => {
        failures.push(trigger)
      },
    },
  })
  const request: PiRuntimeRequest = {
    threadID: "thread-runtime-compaction",
    turnID: "turn-runtime-compaction",
    agentID: "agent-runtime-compaction",
    sessionID,
    content: "original runtime request",
    taskMode: "chat",
    permissionConfig: DEFAULT_PERMISSION_CONFIG,
    signal: new AbortController().signal,
    workspace: {} as never,
    model: faux.getModel(),
    policyModel: { providerID: "faux", id: "runtime-compaction" } as never,
    exposedTools: [],
    promptSections: [{
      id: "test-system",
      role: "system",
      cache: "global-stable",
      authority: "builtin",
      source: { type: "builtin", name: "test" },
      content: "runtime compaction test",
    }],
  }
  return { runtime, request, compacted, failures }
}

describe("PiAgentRuntime context compaction", () => {
  test("successful turns remain successful when automatic compaction runs afterward", async () => {
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage("completed before compaction"),
        fauxAssistantMessage("automatic compact summary"),
      ],
      shouldAutoCompact: true,
    })

    await expect(setup.runtime.run(setup.request)).resolves.toEqual({
      status: "completed",
      output: "completed before compaction",
    })
    expect(setup.compacted).toEqual(["automatic"])
    expect(setup.failures).toEqual([])
    await setup.runtime.dispose()
  })

  test("automatic compaction failure is recorded without replacing a successful turn", async () => {
    const setup = await createRuntime({
      responses: [
        fauxAssistantMessage("completed before failed compaction"),
        fauxAssistantMessage([], {
          stopReason: "error",
          errorMessage: "summary provider unavailable",
        }),
      ],
      shouldAutoCompact: true,
    })

    await expect(setup.runtime.run(setup.request)).resolves.toEqual({
      status: "completed",
      output: "completed before failed compaction",
    })
    expect(setup.compacted).toEqual([])
    expect(setup.failures).toEqual(["automatic"])
    await setup.runtime.dispose()
  })

  test("provider overflow compacts once and continues without appending the original request again", async () => {
    let continuationContext: Context | undefined
    const setup = await createRuntime({
      responses: [
        providerError(),
        fauxAssistantMessage("reactive compact summary"),
        (context: Context) => {
          continuationContext = context
          return fauxAssistantMessage("continued after compaction")
        },
      ],
    })

    await expect(setup.runtime.run(setup.request)).resolves.toEqual({
      status: "completed",
      output: "continued after compaction",
    })
    expect(setup.compacted).toEqual(["reactive"])
    expect(setup.failures).toEqual([])
    const userMessages = continuationContext?.messages
      .filter((message) => message.role === "user")
      .map(messageText) ?? []
    expect(userMessages.filter((text) => text === setup.request.content)).toHaveLength(1)
    expect(userMessages.at(-1)).toBe(REACTIVE_CONTINUATION_PROMPT)
    await setup.runtime.dispose()
  })

  test("a second overflow stops with a typed error instead of entering a recovery loop", async () => {
    const setup = await createRuntime({
      responses: [
        providerError(),
        fauxAssistantMessage("reactive compact summary"),
        providerError(),
      ],
    })

    const error = await setup.runtime.run(setup.request).catch((cause) => cause)
    expect(error).toBeInstanceOf(AgentError)
    expect((error as AgentError).code).toBe("PI_CONTEXT_WINDOW_EXCEEDED")
    expect((error as AgentError).status).toBe(413)
    expect(setup.compacted).toEqual(["reactive"])
    expect(setup.failures).toEqual(["reactive"])
    await setup.runtime.dispose()
  })
})
