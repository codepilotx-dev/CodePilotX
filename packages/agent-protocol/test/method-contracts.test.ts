import { describe, expect, test } from "bun:test"
import { Credential, Integration, Model, Provider } from "@codepilotx/model-schema"
import { Schema } from "effect"
import { RpcMethods, type RpcMethod, type RpcParams, type RpcResult } from "../src/methods"

const providerId = Schema.decodeUnknownSync(Provider.ID)("provider:test")
const modelId = Schema.decodeUnknownSync(Model.ID)("model:test")
const integrationId = Schema.decodeUnknownSync(Integration.ID)("integration:test")
const integrationMethodId = Schema.decodeUnknownSync(Integration.MethodID)("method:test")
const attemptId = Schema.decodeUnknownSync(Integration.AttemptID)("attempt:test")
const credentialId = Schema.decodeUnknownSync(Credential.ID)("credential:test")

const modelRef = {
  providerID: providerId,
  id: modelId,
}

const permissionConfig = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
} as const

const threadSettings = {
  taskMode: "chat",
  permissionConfig,
} as const

const project = {
  id: "project:1",
  name: "Fixture project",
  rootPath: "F:\\fixture",
  lastOpenedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  settings: { defaultModel: null },
}

const threadListItem = {
  id: "thread:1",
  projectID: project.id,
  title: "Fixture thread",
  preview: null,
  firstUserMessage: null,
  messageCount: 0,
  latestTurnStatus: null,
  archivedAt: null,
  settings: threadSettings,
  createdAt: 1,
  updatedAt: 1,
}

const threadSnapshot = {
  thread: {
    id: threadListItem.id,
    title: threadListItem.title,
    projectID: project.id,
    settings: threadSettings,
    createdAt: 1,
    updatedAt: 1,
  },
  turns: [],
  agents: [],
  subagents: [],
  inputs: [],
  messages: [],
  items: [],
  approvals: [],
}

const streamPosition = {
  streamId: "stream:thread:1",
  sequence: 1,
}

const admission = {
  inputId: "input:1",
  turnId: "turn:1",
  disposition: "accepted",
  streamPosition,
} as const

const sandboxStatus = {
  state: "available",
  platform: "win32",
  architecture: "x64",
  runtimeVersion: "1.0.0",
  error: null,
  operations: {
    canInstall: false,
    canRepair: true,
    canUninstall: true,
  },
} as const

const attachment = {
  id: "attachment:1",
  kind: "text",
  name: "fixture.txt",
  mediaType: "text/plain",
  sizeBytes: 7,
  sha256: "fixture-sha256",
  createdAt: 1,
} as const

const memoryEntry = {
  id: "memory:1",
  scope: "project",
  projectId: project.id,
  content: "Use Bun for this project.",
  sourceThreadId: threadListItem.id,
  createdAt: 1,
  updatedAt: 1,
} as const

const promptPreview = {
  instructions: "Fixture instructions",
  contextItems: [],
  diagnostics: [],
  cacheSegments: [],
  cacheBoundaries: [],
  baseHash: "base-hash",
  contextHash: "context-hash",
  cacheHash: "cache-hash",
  cacheKey: "cache-key",
  cacheMode: { provider: "other", strategy: "stable-prefix" },
  sections: [],
  baseline: null,
} as const

const promptSettingsSnapshot = {
  engine: "prompt-engine-v2",
  version: 2,
  snapshottedAt: 1,
  settings: {},
} as const

const subagentWorkspace = {
  mode: "worktree",
  state: "ready",
  rootPath: "F:\\fixture-worktree",
  baselineRef: "HEAD",
} as const

const subagentRun = {
  id: "run:1",
  taskId: "task:1",
  generation: 1,
  status: "completed",
  queueReason: null,
  model: modelRef,
  permissionConfig,
  result: null,
  error: null,
  createdAt: 1,
  startedAt: 1,
  finishedAt: 2,
  updatedAt: 2,
} as const

const subagentTask = {
  id: "task:1",
  parentThreadId: threadListItem.id,
  parentTurnId: "turn:1",
  parentAgentId: "agent:1",
  childThreadId: "thread:child:1",
  displayName: "Fixture subagent",
  profile: "worker",
  task: "Inspect the fixture.",
  permissionCeiling: permissionConfig,
  workspace: subagentWorkspace,
  currentRun: null,
  createdAt: 1,
  updatedAt: 2,
} as const

const subagentCapabilities = {
  canSend: true,
  canStop: false,
  canRetry: true,
  canApplyWorktree: true,
  canDiscardWorktree: true,
  canRestoreWorkspace: true,
}

const integrationInfo = {
  id: integrationId,
  name: "Fixture integration",
  methods: [],
  connections: [],
}

const attemptTime = { created: 1, expires: 2 }
const integrationAttempt = {
  attemptID: attemptId,
  url: "https://example.test/authorize",
  instructions: "Authorize the fixture integration.",
  mode: "code",
  time: attemptTime,
} as const

const integrationAttemptState = {
  attemptId,
  integrationId,
  status: { status: "pending", time: attemptTime },
  connection: null,
} as const

const modelCatalog = {
  providers: [],
  defaultModel: modelRef,
  reviewerModel: null,
  catalogVersion: 1,
}

const methodFixture = <M extends RpcMethod>(
  _method: M,
  params: RpcParams<M>,
  result: RpcResult<M>,
) => ({ params, result })

type MethodFixtures = {
  readonly [M in RpcMethod]: {
    readonly params: RpcParams<M>
    readonly result: RpcResult<M>
  }
}

const fixtures = {
  initialize: methodFixture("initialize", {
    clientInfo: { name: "CodePilotX Desktop", version: "0.1.0", platform: "win32", instanceId: "client:1" },
    protocols: ["thread-rpc-v3"],
    capabilities: ["event.stream.v1"],
    interactionDelivery: "active",
  }, {
    protocol: "thread-rpc-v3",
    serverInfo: { name: "CodePilotX Agent", version: "0.1.0" },
    capabilities: ["event.stream.v1"],
    limits: {
      maxFrameBytes: 1_000_000,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 32,
      maxPendingRequests: 16,
    },
    connectionId: "connection:1",
  }),
  shutdown: methodFixture("shutdown", { operationId: "operation:shutdown" }, { ok: true, acceptedAt: 1 }),
  "event/subscribe": methodFixture("event/subscribe", {
    streams: [{ streamId: streamPosition.streamId, after: 0 }],
    liveEventTypes: ["turn/delta"],
  }, {
    subscriptionId: "subscription:1",
    highWatermarks: [streamPosition],
  }),
  "event/ack": methodFixture("event/ack", {
    subscriptionId: "subscription:1",
    positions: [streamPosition],
  }, {
    subscriptionId: "subscription:1",
    acknowledged: [streamPosition],
  }),
  "event/unsubscribe": methodFixture("event/unsubscribe", { subscriptionId: "subscription:1" }, { ok: true }),
  "interaction/listPending": methodFixture("interaction/listPending", {
    threadId: threadListItem.id,
    kinds: ["plan"],
    cursor: "cursor:1",
    limit: 20,
  }, {
    interactions: [],
    nextCursor: null,
  }),
  "interaction/respond": methodFixture("interaction/respond", {
    interactionId: "interaction:1",
    expectedVersion: 1,
    response: { kind: "plan", decision: "continue" },
    operationId: "operation:interaction",
  }, {
    interactionId: "interaction:1",
    kind: "plan",
    state: "resolved",
    version: 2,
    resolvedAt: 2,
    response: { kind: "plan", decision: "continue" },
  }),
  "project/list": methodFixture("project/list", { cursor: "cursor:1", limit: 20 }, { projects: [project], nextCursor: null }),
  "project/open": methodFixture("project/open", {
    rootPath: project.rootPath,
    operationId: "operation:project-open",
  }, { project }),
  "project/settings/update": methodFixture("project/settings/update", {
    projectId: project.id,
    settings: { defaultModel: modelRef },
    operationId: "operation:project-settings",
  }, {
    projectId: project.id,
    settings: { defaultModel: modelRef },
    version: 2,
  }),
  "thread/list": methodFixture("thread/list", {
    projectId: project.id,
    archived: false,
    cursor: "cursor:1",
    limit: 20,
  }, { threads: [threadListItem], nextCursor: null }),
  "thread/create": methodFixture("thread/create", {
    projectId: project.id,
    title: threadListItem.title,
    settings: threadSettings,
    operationId: "operation:thread-create",
  }, { snapshot: threadSnapshot, streamPosition }),
  "thread/read": methodFixture("thread/read", { threadId: threadListItem.id }, { snapshot: threadSnapshot, streamPosition }),
  "thread/update": methodFixture("thread/update", {
    threadId: threadListItem.id,
    patch: { title: "Updated fixture thread", archived: false },
    operationId: "operation:thread-update",
    expectedVersion: 1,
  }, { thread: threadListItem }),
  "thread/settings/update": methodFixture("thread/settings/update", {
    threadId: threadListItem.id,
    settings: { taskMode: "plan" },
    operationId: "operation:thread-settings",
    expectedVersion: 1,
  }, {
    threadId: threadListItem.id,
    settings: threadSettings,
    version: 2,
  }),
  "thread/delete": methodFixture("thread/delete", {
    threadId: threadListItem.id,
    operationId: "operation:thread-delete",
  }, { threadId: threadListItem.id, deletedAt: 2 }),
  "prompt/preview": methodFixture("prompt/preview", { threadId: threadListItem.id }, {
    threadId: threadListItem.id,
    preview: promptPreview,
    cacheKey: promptPreview.cacheKey,
  }),
  "prompt/refresh": methodFixture("prompt/refresh", {
    threadId: threadListItem.id,
    operationId: "operation:prompt-refresh",
  }, {
    threadId: threadListItem.id,
    settings: promptSettingsSnapshot,
    cacheKey: promptPreview.cacheKey,
  }),
  "thread/compact": methodFixture("thread/compact", {
    threadId: threadListItem.id,
    operationId: "operation:thread-compact",
  }, {
    compaction: {
      id: "compaction:1",
      beforeCount: 10,
      afterCount: 4,
      beforeTokens: 1_000,
      afterTokens: 400,
      targetTokens: 500,
      usageSampleId: "usage:1",
      baselineVersion: 2,
    },
  }),
  "turn/start": methodFixture("turn/start", {
    threadId: threadListItem.id,
    inputId: admission.inputId,
    content: "Start the fixture turn.",
    attachmentIds: [attachment.id],
    model: modelRef,
    permissionConfig,
    taskMode: "chat",
  }, admission),
  "turn/steer": methodFixture("turn/steer", {
    threadId: threadListItem.id,
    turnId: admission.turnId,
    inputId: "input:steer:1",
    content: "Steer the fixture turn.",
    attachmentIds: [attachment.id],
  }, { ...admission, inputId: "input:steer:1" }),
  "turn/interrupt": methodFixture("turn/interrupt", {
    threadId: threadListItem.id,
    turnId: admission.turnId,
    operationId: "operation:turn-interrupt",
  }, {
    threadId: threadListItem.id,
    turnId: admission.turnId,
    status: "interrupted",
  }),
  "turn/resume": methodFixture("turn/resume", {
    threadId: threadListItem.id,
    turnId: admission.turnId,
    operationId: "operation:turn-resume",
  }, {
    threadId: threadListItem.id,
    turnId: admission.turnId,
    status: "running",
  }),
  "queue/update": methodFixture("queue/update", {
    threadId: threadListItem.id, inputId: "input:queued:1", content: "edited", operationId: "operation:queue-update", expectedVersion: 1,
  }, { threadId: threadListItem.id, version: 2, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "queue/remove": methodFixture("queue/remove", {
    threadId: threadListItem.id, inputId: "input:queued:1", operationId: "operation:queue-remove", expectedVersion: 2,
  }, { threadId: threadListItem.id, version: 3, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "queue/reorder": methodFixture("queue/reorder", {
    threadId: threadListItem.id, inputIds: ["input:queued:2", "input:queued:1"], operationId: "operation:queue-reorder", expectedVersion: 3,
  }, { threadId: threadListItem.id, version: 4, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "queue/steer": methodFixture("queue/steer", {
    threadId: threadListItem.id, inputId: "input:queued:1", operationId: "operation:queue-steer", expectedVersion: 4,
  }, { threadId: threadListItem.id, version: 5, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "queue/resume": methodFixture("queue/resume", {
    threadId: threadListItem.id, operationId: "operation:queue-resume", expectedVersion: 5,
  }, { threadId: threadListItem.id, version: 6, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "sandbox/status": methodFixture("sandbox/status", {}, { sandbox: sandboxStatus }),
  "sandbox/install": methodFixture("sandbox/install", { operationId: "operation:sandbox-install" }, { sandbox: sandboxStatus }),
  "sandbox/repair": methodFixture("sandbox/repair", { operationId: "operation:sandbox-repair" }, { sandbox: sandboxStatus }),
  "sandbox/uninstall": methodFixture("sandbox/uninstall", {
    confirm: true,
    operationId: "operation:sandbox-uninstall",
  }, { sandbox: sandboxStatus }),
  "attachment/import": methodFixture("attachment/import", {
    uploads: [{ kind: "text", name: attachment.name, mediaType: attachment.mediaType, encoding: "utf8", data: "fixture" }],
    operationId: "operation:attachment-import",
  }, { attachments: [attachment] }),
  "attachment/read": methodFixture("attachment/read", {
    attachmentId: attachment.id,
    range: { offset: 0, length: 7 },
  }, {
    attachment,
    data: "fixture",
    encoding: "utf8",
    range: { offset: 0, length: 7, total: 7 },
  }),
  "memory/list": methodFixture("memory/list", {
    scope: "project",
    projectId: project.id,
    cursor: "cursor:1",
    limit: 20,
  }, { entries: [memoryEntry], nextCursor: null }),
  "memory/read": methodFixture("memory/read", {
    scope: "project",
    projectId: project.id,
    id: memoryEntry.id,
  }, { entry: memoryEntry }),
  "memory/save": methodFixture("memory/save", {
    scope: "project",
    projectId: project.id,
    id: memoryEntry.id,
    content: memoryEntry.content,
    operationId: "operation:memory-save",
  }, { entry: memoryEntry }),
  "memory/delete": methodFixture("memory/delete", {
    scope: "project",
    projectId: project.id,
    id: memoryEntry.id,
    operationId: "operation:memory-delete",
  }, { deleted: true, id: memoryEntry.id }),
  "memory/reset": methodFixture("memory/reset", {
    scope: "project",
    projectId: project.id,
    includeEventLog: true,
    operationId: "operation:memory-reset",
  }, { deleted: 1 }),
  "subagent/list": methodFixture("subagent/list", {
    threadId: threadListItem.id,
    cursor: "cursor:1",
    limit: 20,
  }, { subagents: [{ task: subagentTask, currentRun: subagentRun }], nextCursor: null }),
  "subagent/read": methodFixture("subagent/read", { taskId: subagentTask.id }, {
    task: subagentTask,
    currentRun: subagentRun,
    snapshot: threadSnapshot,
    capabilities: subagentCapabilities,
  }),
  "subagent/send": methodFixture("subagent/send", {
    taskId: subagentTask.id,
    inputId: "input:subagent:1",
    message: "Continue the fixture task.",
    model: modelRef,
    permissionConfig,
    attachmentIds: [attachment.id],
  }, {
    ...admission,
    inputId: "input:subagent:1",
    taskId: subagentTask.id,
    runId: subagentRun.id,
  }),
  "subagent/stop": methodFixture("subagent/stop", {
    taskId: subagentTask.id,
    operationId: "operation:subagent-stop",
  }, { task: subagentTask, run: subagentRun }),
  "subagent/retry": methodFixture("subagent/retry", {
    taskId: subagentTask.id,
    operationId: "operation:subagent-retry",
  }, { task: subagentTask, run: subagentRun, admission }),
  "subagent/worktree/diff": methodFixture("subagent/worktree/diff", {
    taskId: subagentTask.id,
    maxBytes: 64_000,
    contextLines: 3,
  }, { diff: "diff --git a/fixture b/fixture", truncated: false }),
  "subagent/worktree/apply": methodFixture("subagent/worktree/apply", {
    taskId: subagentTask.id,
    operationId: "operation:worktree-apply",
  }, { result: { taskId: subagentTask.id, action: "apply", outcome: "changed", workspace: subagentWorkspace } }),
  "subagent/worktree/discard": methodFixture("subagent/worktree/discard", {
    taskId: subagentTask.id,
    operationId: "operation:worktree-discard",
  }, { result: { taskId: subagentTask.id, action: "discard", outcome: "unchanged", workspace: subagentWorkspace } }),
  "subagent/workspace/restore": methodFixture("subagent/workspace/restore", {
    taskId: subagentTask.id,
    operationId: "operation:workspace-restore",
  }, { result: { taskId: subagentTask.id, action: "restore", outcome: "changed", workspace: subagentWorkspace } }),
  "model/list": methodFixture("model/list", {
    providerId,
    query: "fixture",
    enabled: true,
    inputModality: "text",
    outputModality: "text",
  }, modelCatalog),
  "model/refresh": methodFixture("model/refresh", { operationId: "operation:model-refresh" }, modelCatalog),
  "model/setDefault": methodFixture("model/setDefault", {
    model: modelRef,
    operationId: "operation:model-default",
  }, { defaultModel: modelRef, settingsVersion: 2 }),
  "model/setReviewer": methodFixture("model/setReviewer", {
    model: modelRef,
    operationId: "operation:model-reviewer",
  }, { reviewerModel: modelRef, settingsVersion: 2 }),
  "provider/test": methodFixture("provider/test", { providerId }, {
    providerId,
    status: "reachable",
    testedAt: 1,
    latencyMs: 12,
  }),
  "provider/updateSettings": methodFixture("provider/updateSettings", {
    providerId,
    settings: {
      name: "Fixture provider",
      headers: { "x-client-version": "0.1.0" },
      whitelist: [modelId],
    },
    sensitiveHeaders: [{ name: "authorization", value: "fixture-secret" }],
    operationId: "operation:provider-settings",
  }, {
    provider: {
      id: providerId,
      name: "Fixture provider",
      disabled: false,
      configured: true,
      modelCount: 1,
    },
    catalogVersion: 2,
  }),
  "integration/list": methodFixture("integration/list", { kind: "oauth", status: "connected" }, { integrations: [integrationInfo] }),
  "integration/connect": methodFixture("integration/connect", {
    integrationId,
    key: "fixture-key",
    label: "Fixture credential",
    operationId: "operation:integration-connect",
  }, { integration: integrationInfo }),
  "integration/authorize": methodFixture("integration/authorize", {
    integrationId,
    methodId: integrationMethodId,
    inputs: { tenant: "fixture" },
    label: "Fixture OAuth",
    operationId: "operation:integration-authorize",
  }, { attempt: integrationAttempt }),
  "integration/authorizeComplete": methodFixture("integration/authorizeComplete", {
    attemptId,
    code: "fixture-code",
    operationId: "operation:integration-complete",
  }, { attempt: integrationAttemptState, integration: integrationInfo }),
  "integration/authorizeStatus": methodFixture("integration/authorizeStatus", { attemptId }, { attempt: integrationAttemptState }),
  "integration/disconnect": methodFixture("integration/disconnect", {
    integrationId,
    credentialId,
    operationId: "operation:integration-disconnect",
  }, { integration: integrationInfo }),
} satisfies MethodFixtures

describe("RPC method schema contracts", () => {
  test("keeps valid params and results for all 60 formal methods decodable", () => {
    const methods = Object.keys(RpcMethods) as RpcMethod[]
    expect(methods).toHaveLength(60)
    expect(Object.keys(fixtures).sort()).toEqual([...methods].sort())

    for (const method of methods) {
      const definition = RpcMethods[method]
      const fixture = fixtures[method]
      const params = Schema.decodeUnknownSync(
        definition.params,
        definition.exactParams ? { onExcessProperty: "error" } : undefined,
      )(fixture.params)
      const result = Schema.decodeUnknownSync(definition.result)(fixture.result)
      const encodedParams = Schema.encodeSync(definition.params)(params)
      const encodedResult = Schema.encodeSync(definition.result)(result)

      expect(params, `${method} params`).toEqual(fixture.params)
      expect(result, `${method} result`).toEqual(fixture.result)
      expect(encodedParams as unknown, `${method} encoded params`).toEqual(fixture.params as unknown)
      expect(encodedResult as unknown, `${method} encoded result`).toEqual(fixture.result as unknown)
    }
  })

  test("rejects invalid opaque IDs, limits, and enums", () => {
    expect(() => Schema.decodeUnknownSync(RpcMethods["thread/read"].params)({ threadId: "" })).toThrow()

    const decodeProjectList = Schema.decodeUnknownSync(RpcMethods["project/list"].params)
    expect(() => decodeProjectList({ limit: 0 })).toThrow()
    expect(() => decodeProjectList({ limit: 501 })).toThrow()

    expect(() => Schema.decodeUnknownSync(RpcMethods.initialize.params)({
      ...fixtures.initialize.params,
      interactionDelivery: "background",
    })).toThrow()
    expect(() => Schema.decodeUnknownSync(RpcMethods["turn/start"].params)({
      ...fixtures["turn/start"].params,
      taskMode: "execute",
    })).toThrow()
  })

  test("rejects excess fields for every security-sensitive exact params schema", () => {
    const exactMethods = (Object.keys(RpcMethods) as RpcMethod[]).filter((method) => RpcMethods[method].exactParams)
    expect(exactMethods.length).toBeGreaterThan(0)

    for (const method of exactMethods) {
      expect(() => Schema.decodeUnknownSync(RpcMethods[method].params, { onExcessProperty: "error" })({
        ...fixtures[method].params,
        unexpectedSensitiveField: "must-not-pass",
      }), method).toThrow()
    }
  })

  test("requires authorized projectId instead of internal projectKey for project memory", () => {
    for (const method of ["memory/list", "memory/read", "memory/save", "memory/delete", "memory/reset"] as const) {
      const invalid: Record<string, unknown> = {
        ...(fixtures[method].params as Record<string, unknown>),
        projectKey: "F:\\private-workspace",
      }
      delete invalid.projectId
      expect(() => Schema.decodeUnknownSync(RpcMethods[method].params)(invalid), method).toThrow()
    }

    for (const method of ["memory/list", "memory/read", "memory/save"] as const) {
      const result = structuredClone(fixtures[method].result) as Record<string, unknown>
      const entry = method === "memory/list"
        ? (result.entries as Array<Record<string, unknown>>)[0]
        : result.entry as Record<string, unknown>
      if (entry === undefined) throw new Error(`Missing ${method} fixture entry`)
      entry.projectKey = "F:\\private-workspace"
      expect(() => Schema.decodeUnknownSync(
        RpcMethods[method].result,
        { onExcessProperty: "error" },
      )(result), `${method} result`).toThrow()
    }
  })

  test("rejects replacement history from compaction results", () => {
    const result = structuredClone(fixtures["thread/compact"].result)
    expect(() => Schema.decodeUnknownSync(
      RpcMethods["thread/compact"].result,
      { onExcessProperty: "error" },
    )({
      ...result,
      compaction: { ...result.compaction, replacementHistory: [{ from: "old", to: "new" }] },
    })).toThrow()
  })

  test("rejects sandbox runtime internals from the public result", () => {
    expect(() => Schema.decodeUnknownSync(
      RpcMethods["sandbox/status"].result,
      { onExcessProperty: "error" },
    )({
      sandbox: {
        ...sandboxStatus,
        helperPath: "C:\\private\\sandbox-helper.exe",
        helperSha256: "private-helper-hash",
        user: { provisioned: true },
        wfp: { state: "installed" },
      },
    })).toThrow()
  })

  test("accepts provider secrets only through the write-only channel", () => {
    expect(() => Schema.decodeUnknownSync(
      RpcMethods["provider/updateSettings"].params,
      { onExcessProperty: "error" },
    )({
      ...fixtures["provider/updateSettings"].params,
      settings: { headers: { authorization: "fixture-secret" } },
    })).toThrow()

    expect(() => Schema.decodeUnknownSync(
      RpcMethods["provider/updateSettings"].result,
      { onExcessProperty: "error" },
    )({
      ...fixtures["provider/updateSettings"].result,
      apiKey: "fixture-secret",
      provider: {
        ...fixtures["provider/updateSettings"].result.provider,
        sensitiveHeaders: [{ name: "authorization", value: "fixture-secret" }],
      },
    })).toThrow()
  })
})
