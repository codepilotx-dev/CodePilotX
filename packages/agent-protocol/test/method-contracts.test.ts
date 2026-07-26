import { describe, expect, test } from "bun:test"
import { Credential, Integration, Model, Provider } from "@codepilotx/model-schema"
import { Schema } from "effect"
import { RpcMethods, type RpcMethod, type RpcParams, type RpcResult } from "../src/methods/index"

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
  primaryFolderId: "folder:1",
  folders: [{
    id: "folder:1",
    name: "fixture",
    path: "F:\\fixture",
    role: "primary",
    availability: "available",
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }] as const,
  removedAt: null,
  lastOpenedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  settings: { defaultModel: null, instructions: "", version: 1 },
}

const threadListItem = {
  id: "thread:1",
  projectID: project.id,
  gitBranch: "codex/hover-card",
  workspace: {
    kind: "project",
    projectID: project.id,
    cwd: project.folders[0].path,
    runtimeWorkspaceRoots: [{
      folderId: project.folders[0].id,
      path: project.folders[0].path,
      role: "primary",
    }],
    instructionSources: [],
    outputDirectory: null,
  } as const,
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
    gitBranch: threadListItem.gitBranch,
    workspace: threadListItem.workspace,
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
  maturity: "alpha",
  maxConcurrentCommands: 8,
  error: null,
  operations: {
    canInstall: false,
    canRepair: true,
    canUninstall: true,
  },
} as const

const toolingStatus = {
  id: "git-bash",
  preference: "managed",
  phase: "ready",
  activeSource: "managed",
  pinnedVersion: "2.55.0.3",
  managed: { installed: true, version: "2.55.0.3" },
  system: { available: false, version: null, path: null },
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

const githubUser = {
  login: "octocat",
  id: 1,
  name: "Octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
  htmlUrl: "https://github.com/octocat",
}

const githubAuth = {
  configured: true,
  authenticated: true,
  user: githubUser,
}

const githubLogin = {
  loginId: "github-login:1",
  mode: "device",
  state: "awaiting_auth",
  authorizationUrl: null,
  userCode: "ABCD-EFGH",
  verificationUri: "https://github.com/login/device",
  expiresAt: "2026-07-18T10:00:00.000Z",
  error: null,
  auth: null,
  elapsedMs: 1,
} as const

const githubRepository = {
  id: 1,
  name: "fixture",
  fullName: "octocat/fixture",
  owner: "octocat",
  private: false,
  fork: false,
  archived: false,
  disabled: false,
  cloneUrl: "https://github.com/octocat/fixture.git",
  sshUrl: "git@github.com:octocat/fixture.git",
  htmlUrl: "https://github.com/octocat/fixture",
  description: "Fixture repository",
  defaultBranch: "main",
  pushedAt: "2026-07-18T09:00:00.000Z",
  updatedAt: "2026-07-18T09:00:00.000Z",
}

const githubPullRequest = {
  id: 10,
  number: 7,
  title: "Fixture pull request",
  body: "Fixture body",
  state: "open",
  draft: false,
  htmlUrl: "https://github.com/octocat/fixture/pull/7",
  base: { ref: "main", sha: "base-sha" },
  head: { ref: "feature", sha: "head-sha" },
  additions: 2,
  deletions: 1,
  changedFiles: 1,
  mergeable: true,
}

const githubProfileRepository = {
  id: "repo:1",
  name: "fixture",
  fullName: "octocat/fixture",
  url: "https://github.com/octocat/fixture",
  description: null,
  isPrivate: false,
  isFork: false,
  primaryLanguage: { name: "TypeScript", color: "#3178c6" },
  stargazerCount: 1,
  forkCount: 0,
  updatedAt: "2026-07-18T09:00:00.000Z",
}

const githubProfileOverview = {
  user: {
    ...githubUser,
    bio: null,
    company: null,
    location: null,
    websiteUrl: null,
    email: null,
    followers: 1,
    following: 0,
    repositoryCount: 1,
    starredRepositoryCount: 1,
    status: null,
  },
  organizations: [],
  pinnedRepositories: [githubProfileRepository],
  popularRepositories: [githubProfileRepository],
  contributions: {
    totalContributions: 1,
    totalCommitContributions: 1,
    totalIssueContributions: 0,
    totalPullRequestContributions: 0,
    totalPullRequestReviewContributions: 0,
    restrictedContributionsCount: 0,
    weeks: [{ days: [{ date: "2026-07-18", count: 1, color: "#40c463" }] }],
  },
}

const modelCatalog = {
  providers: [],
  defaultModel: modelRef,
  reviewerModel: null,
  catalogVersion: 1,
}

const apiKeySummary = {
  id: credentialId,
  providerId,
  label: "Fixture API Key",
  maskedValue: "••••test",
  enabled: true,
  active: true,
  priority: 0,
  health: { status: "healthy" as const, lastTestedAt: 1, lastUsedAt: 2 },
  createdAt: 1,
  updatedAt: 2,
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
  "config/read": methodFixture("config/read", {
    includeLayers: true,
    cwd: "F:/CodeProject/example",
  }, {
    config: { model: "gpt-5.6", desktop: { showContextUsage: true } },
    origins: { model: "user", "desktop.showContextUsage": "user" },
    layers: [{
      kind: "user",
      displayName: "用户配置",
      filePath: "C:/Users/example/.codepilotx/config.toml",
      version: "a".repeat(64),
      writable: true,
      trusted: true,
      config: { model: "gpt-5.6" },
    }],
    diagnostics: [],
  }),
  "config/value/write": methodFixture("config/value/write", {
    keyPath: ["desktop", "showContextUsage"],
    value: true,
    expectedVersion: "a".repeat(64),
  }, {
    status: "ok",
    version: "b".repeat(64),
    filePath: "C:/Users/example/.codepilotx/config.toml",
  }),
  "config/batchWrite": methodFixture("config/batchWrite", {
    edits: [
      { keyPath: ["model"], value: "gpt-5.6" },
      { keyPath: ["desktop", "reviewView"], value: "inline" },
    ],
    expectedVersion: "b".repeat(64),
    reloadUserConfig: true,
  }, {
    status: "ok-overridden",
    version: "c".repeat(64),
    filePath: "C:/Users/example/.codepilotx/config.toml",
    overridden: [{ keyPath: ["model"], by: "project" }],
  }),
  "project/trust/read": methodFixture("project/trust/read", {
    cwd: "F:/CodeProject/example",
  }, {
    projectRoot: "F:/CodeProject/example",
    trustLevel: "untrusted",
    hasProjectConfig: true,
  }),
  "project/trust/update": methodFixture("project/trust/update", {
    cwd: "F:/CodeProject/example",
    trustLevel: "trusted",
    expectedVersion: "c".repeat(64),
  }, {
    status: "ok",
    version: "d".repeat(64),
    filePath: "C:/Users/example/.codepilotx/config.toml",
  }),
  initialize: methodFixture("initialize", {
    clientInfo: { name: "CodePilotX Desktop", version: "0.1.0", platform: "win32", instanceId: "client:1" },
    protocols: ["thread-rpc-v4"],
    capabilities: ["event.stream.v1"],
    interactionDelivery: "active",
  }, {
    protocol: "thread-rpc-v4",
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
    kinds: ["question"],
    cursor: "cursor:1",
    limit: 20,
  }, {
    interactions: [],
    nextCursor: null,
  }),
  "interaction/respond": methodFixture("interaction/respond", {
    interactionId: "interaction:1",
    expectedVersion: 1,
    response: { kind: "question", status: "ignored" },
    operationId: "operation:interaction",
  }, {
    interactionId: "interaction:1",
    kind: "question",
    state: "resolved",
    version: 2,
    resolvedAt: 2,
    response: { kind: "question", status: "ignored" },
  }),
  "project/list": methodFixture("project/list", { cursor: "cursor:1", limit: 20, folderPath: project.folders[0].path }, { projects: [project], nextCursor: null }),
  "project/create": methodFixture("project/create", {
    name: project.name,
    primaryPath: project.folders[0].path,
    operationId: "operation:project-create",
  }, { project }),
  "project/open": methodFixture("project/open", {
    projectId: project.id,
    operationId: "operation:project-open",
  }, { project }),
  "project/update": methodFixture("project/update", {
    projectId: project.id,
    name: project.name,
    expectedVersion: project.updatedAt,
    operationId: "operation:project-update",
  }, { project }),
  "project/remove": methodFixture("project/remove", {
    projectId: project.id,
    operationId: "operation:project-remove",
  }, { projectId: project.id, removedAt: 2, archivedThreadCount: 1 }),
  "project/context/read": methodFixture("project/context/read", {
    projectId: project.id,
  }, { project, sources: [] }),
  "project/folder/add": methodFixture("project/folder/add", {
    projectId: project.id,
    path: "F:\\fixture-secondary",
    operationId: "operation:folder-add",
  }, { project, changed: true }),
  "project/folder/remove": methodFixture("project/folder/remove", {
    projectId: project.id,
    folderId: "folder:2",
    operationId: "operation:folder-remove",
  }, { project, changed: true }),
  "project/folder/set-primary": methodFixture("project/folder/set-primary", {
    projectId: project.id,
    folderId: project.primaryFolderId,
    operationId: "operation:folder-primary",
  }, { project, changed: false }),
  "project/settings/update": methodFixture("project/settings/update", {
    projectId: project.id,
    settings: { defaultModel: modelRef, instructions: "Project instructions" },
    expectedVersion: 1,
    operationId: "operation:project-settings",
  }, {
    projectId: project.id,
    settings: { defaultModel: modelRef, instructions: "Project instructions", version: 2 },
    version: 2,
  }),
  "project/source/list": methodFixture("project/source/list", {
    projectId: project.id,
    cursor: "offset:0",
    limit: 20,
  }, { sources: [], nextCursor: null }),
  "project/source/import": methodFixture("project/source/import", {
    projectId: project.id,
    uploads: [{
      kind: "text",
      name: "context.md",
      mediaType: "text/markdown",
      encoding: "utf8",
      data: "# Context",
    }],
    operationId: "operation:source-import",
  }, { sources: [] }),
  "project/source/reference/add": methodFixture("project/source/reference/add", {
    projectId: project.id,
    folderId: project.primaryFolderId,
    path: "README.md",
    operationId: "operation:source-reference",
  }, { sources: [] }),
  "project/source/read": methodFixture("project/source/read", {
    projectId: project.id,
    sourceId: "source:1",
    range: { offset: 0, length: 100 },
  }, {
    source: {
      storage: "managed",
      id: "source:1",
      projectId: project.id,
      kind: "text",
      name: "context.md",
      mediaType: "text/markdown",
      sizeBytes: 9,
      sha256: "a".repeat(64),
      status: "available",
    },
    data: "# Context",
    encoding: "utf8",
    range: { offset: 0, length: 9, total: 9 },
  }),
  "project/source/remove": methodFixture("project/source/remove", {
    projectId: project.id,
    sourceId: "source:1",
    operationId: "operation:source-remove",
  }, { sourceId: "source:1", removed: true }),
  "workspace/file/list": methodFixture("workspace/file/list", {
    projectId: project.id,
    folderId: project.primaryFolderId,
    path: ".",
  }, {
    entries: [
      { name: "src", path: "src", type: "directory", depth: 0 },
      { name: "README.md", path: "README.md", type: "file", depth: 0 },
    ],
  }),
  "workspace/file/read": methodFixture("workspace/file/read", {
    projectId: project.id,
    folderId: project.primaryFolderId,
    path: "src/index.ts",
  }, {
    path: "src/index.ts",
    content: "export {}",
    sizeBytes: 9,
    readonly: false,
    truncated: false,
    revision: { mtimeMs: 1, sha256: "a".repeat(64) },
  }),
  "workspace/file/save": methodFixture("workspace/file/save", {
    projectId: project.id,
    folderId: project.primaryFolderId,
    path: "src/index.ts",
    content: "export {}",
    expectedRevision: { mtimeMs: 1, sha256: "a".repeat(64) },
  }, {
    outcome: "saved",
    revision: { mtimeMs: 2, sha256: "b".repeat(64) },
  }),
  "workspace/file/watch": methodFixture("workspace/file/watch", {
    projectId: project.id,
    folderId: project.primaryFolderId,
    path: "src/index.ts",
  }, {
    watching: true,
    path: "src/index.ts",
  }),
  "workspace/file/unwatch": methodFixture("workspace/file/unwatch", {
    projectId: project.id,
    folderId: project.primaryFolderId,
    path: "src/index.ts",
  }, {
    watching: false,
    path: "src/index.ts",
  }),
  "thread/list": methodFixture("thread/list", {
    projectId: project.id,
    archived: false,
    cursor: "cursor:1",
    limit: 20,
  }, { threads: [threadListItem], nextCursor: null }),
  "thread/create": methodFixture("thread/create", {
    workspace: { kind: "project", projectId: project.id },
    title: threadListItem.title,
    settings: threadSettings,
    operationId: "operation:thread-create",
  }, { snapshot: threadSnapshot, streamPosition }),
  "thread/read": methodFixture("thread/read", { threadId: threadListItem.id }, { snapshot: threadSnapshot, streamPosition }),
  "thread/history/read": methodFixture("thread/history/read", {
    threadId: threadListItem.id,
    before: "history-cursor:1",
    limit: 10,
  }, {
    thread: threadSnapshot.thread,
    subagents: [],
    turns: [],
    queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
    olderCursor: null,
    hasOlder: false,
    streamPosition,
  }),
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
  "queue/add": methodFixture("queue/add", {
    threadId: threadListItem.id,
    inputId: "input:queued:1",
    content: "Queue the fixture follow-up.",
    attachmentIds: [attachment.id],
    model: modelRef,
    permissionConfig,
    taskMode: "chat",
    operationId: "operation:queue-add",
    expectedVersion: 1,
  }, {
    ...admission,
    inputId: "input:queued:1",
    admission: "queued",
  }),
  "queue/update": methodFixture("queue/update", {
    threadId: threadListItem.id, inputId: "input:queued:1", content: "edited", operationId: "operation:queue-update", expectedVersion: 1,
  }, { threadId: threadListItem.id, version: 2, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "queue/remove": methodFixture("queue/remove", {
    threadId: threadListItem.id, inputId: "input:queued:1", operationId: "operation:queue-remove", expectedVersion: 2,
  }, { threadId: threadListItem.id, version: 3, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "queue/resume": methodFixture("queue/resume", {
    threadId: threadListItem.id, operationId: "operation:queue-resume", expectedVersion: 3,
  }, { threadId: threadListItem.id, version: 4, pauseReason: null, turns: [], inputs: [], streamPosition }),
  "sandbox/status": methodFixture("sandbox/status", {}, { sandbox: sandboxStatus }),
  "sandbox/refresh": methodFixture("sandbox/refresh", {}, { sandbox: sandboxStatus }),
  "sandbox/install": methodFixture("sandbox/install", { operationId: "operation:sandbox-install" }, { sandbox: sandboxStatus }),
  "sandbox/repair": methodFixture("sandbox/repair", { operationId: "operation:sandbox-repair" }, { sandbox: sandboxStatus }),
  "sandbox/uninstall": methodFixture("sandbox/uninstall", {
    confirm: true,
    operationId: "operation:sandbox-uninstall",
  }, { sandbox: sandboxStatus }),
  "tooling/list": methodFixture("tooling/list", {}, { statuses: [toolingStatus] }),
  "tooling/refresh": methodFixture("tooling/refresh", {}, { statuses: [toolingStatus] }),
  "tooling/setPreference": methodFixture("tooling/setPreference", {
    id: "git-bash",
    preference: "managed",
    operationId: "operation:tooling-preference",
  }, { status: toolingStatus }),
  "tooling/install": methodFixture("tooling/install", {
    id: "git-bash",
    force: false,
    operationId: "operation:tooling-install",
  }, { status: toolingStatus }),
  "skill/list": methodFixture("skill/list", {
    workspace: "C:\\workspace",
    forceReload: true,
  }, {
    skills: [{
      name: "fixture-skill",
      description: "Fixture skill",
      path: "C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md",
      scope: "workspace",
      format: "codex",
      enabled: true,
    }],
    generation: 1,
    updatedAt: 1,
  }),
  "skill/read": methodFixture("skill/read", {
    workspace: "C:\\workspace",
    path: "C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md",
  }, {
    skill: {
      name: "fixture-skill",
      description: "Fixture skill",
      path: "C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md",
      scope: "workspace",
      format: "codex",
      enabled: true,
    },
    content: "---\nname: fixture-skill\n---\nFixture",
  }),
  "skill/setEnabled": methodFixture("skill/setEnabled", {
    path: "C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md",
    enabled: false,
    operationId: "operation:skill-disable",
  }, {
    skill: {
      name: "fixture-skill",
      description: "Fixture skill",
      path: "C:\\workspace\\.codex\\skills\\fixture-skill\\SKILL.md",
      scope: "workspace",
      format: "codex",
      enabled: false,
    },
    generation: 2,
    updatedAt: 2,
  }),
  "mcp/list": methodFixture("mcp/list", {
    workspace: "C:\\workspace",
  }, {
    servers: [{
      server: {
        name: "fixture",
        scope: "local",
        enabled: true,
        diagnosticContext: true,
        required: true,
        enabledTools: ["echo", "read"],
        disabledTools: ["write"],
        defaultToolsApprovalMode: "writes",
        tools: {
          echo: { approvalMode: "approve" },
        },
        transport: {
          type: "stdio",
          command: "bun",
          args: ["fixture.ts"],
          envFromHost: { MCP_TOKEN: "CODEPILOTX_MCP_TOKEN" },
        },
        startupTimeoutMs: 10_000,
        toolTimeoutMs: 60_000,
      },
      effective: true,
    }],
    generation: 1,
  }),
  "mcp/status": methodFixture("mcp/status", {
    workspace: "C:\\workspace",
  }, {
    servers: [{
      name: "fixture",
      scope: "local",
      type: "stdio",
      state: "connected",
      auth: {
        source: "none",
        canLogin: false,
        canLogout: false,
      },
      toolCount: 1,
      resourceCount: 1,
      promptCount: 1,
    }],
    totalTools: 1,
    totalResources: 1,
    totalPrompts: 1,
    generation: 1,
  }),
  "mcp/save": methodFixture("mcp/save", {
    workspace: "C:\\workspace",
    server: {
      name: "fixture",
      scope: "local",
      enabled: true,
      transport: {
        type: "http",
        url: "https://example.com/mcp",
        auth: "oauth",
        scopes: ["mcp:read", "mcp:write"],
        oauthResource: "https://example.com/",
        headerFromEnv: { Authorization: "CODEPILOTX_MCP_AUTHORIZATION" },
      },
    },
    operationId: "operation:mcp-save:1",
  }, {
    servers: [{
      server: {
        name: "fixture",
        scope: "local",
        enabled: true,
        transport: {
          type: "http",
          url: "https://example.com/mcp",
          auth: "oauth",
          scopes: ["mcp:read", "mcp:write"],
          oauthResource: "https://example.com/",
          headerFromEnv: { Authorization: "CODEPILOTX_MCP_AUTHORIZATION" },
        },
      },
      effective: true,
    }],
    generation: 2,
  }),
  "mcp/remove": methodFixture("mcp/remove", {
    workspace: "C:\\workspace",
    scope: "local",
    name: "fixture",
    operationId: "operation:mcp-remove:1",
  }, {
    servers: [],
    generation: 3,
  }),
  "mcp/setEnabled": methodFixture("mcp/setEnabled", {
    workspace: "C:\\workspace",
    scope: "local",
    name: "fixture",
    enabled: false,
    operationId: "operation:mcp-enabled:1",
  }, {
    servers: [{
      server: {
        name: "fixture",
        scope: "local",
        enabled: false,
        transport: {
          type: "stdio",
          command: "bun",
        },
      },
      effective: true,
    }],
    generation: 4,
  }),
  "mcp/reload": methodFixture("mcp/reload", {
    workspace: "C:\\workspace",
    operationId: "operation:mcp-reload:1",
  }, {
    generation: 5,
    added: ["fixture"],
    replaced: [],
    removed: [],
    unchanged: [],
    failed: [],
  }),
  "mcp/oauth/start": methodFixture("mcp/oauth/start", {
    workspace: "C:\\workspace",
    scope: "local",
    name: "fixture",
    operationId: "operation:mcp-oauth-start:1",
  }, {
    attemptId: "mcp-oauth-attempt:1",
    authorizationUrl: "https://example.com/oauth/authorize",
    expiresAt: 1_800_000_000_000,
  }),
  "mcp/oauth/status": methodFixture("mcp/oauth/status", {
    attemptId: "mcp-oauth-attempt:1",
  }, {
    state: "pending",
  }),
  "mcp/oauth/logout": methodFixture("mcp/oauth/logout", {
    workspace: "C:\\workspace",
    scope: "local",
    name: "fixture",
    operationId: "operation:mcp-oauth-logout:1",
  }, {
    generation: 6,
  }),
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
  "task-suggestion/generate": methodFixture("task-suggestion/generate", {
    workspace: { kind: "project", projectId: project.id },
    context: {
      workspaceName: project.name,
      branchName: "main",
      git: {
        clean: false,
        ahead: 1,
        behind: 0,
        totalFiles: 1,
        files: [{
          path: "src/index.ts",
          status: "modified",
          stagedStatus: "",
          unstagedStatus: "M",
        }],
      },
      recentTasks: [{
        id: threadListItem.id,
        title: threadListItem.title,
        firstPrompt: "Implement task suggestions",
        status: "done",
        updatedAt: 1,
      }],
      localCandidates: [
        {
          id: "local:1",
          categoryId: "codex-review",
          label: "审查当前改动",
          prompt: "Review the current changes",
        },
        {
          id: "local:2",
          categoryId: "codex-fix",
          label: "修复失败测试",
          prompt: "Fix the failing tests",
        },
        {
          id: "local:3",
          categoryId: "codex-explore",
          label: "理解当前架构",
          prompt: "Explore the current architecture",
        },
        {
          id: "local:4",
          categoryId: "codex-create",
          label: "继续构建功能",
          prompt: "Build the next feature",
        },
      ],
    },
  }, {
    contextKey: "suggestion-context:1",
    generatedAt: 1,
    suggestions: [{
      id: "suggestion:1",
      categoryId: "codex-review",
      label: "审查当前任务建议改动",
      prompt: "Review the current task suggestion implementation",
    }],
  }),
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
    cursor: "model-cursor:1",
    limit: 100,
  }, modelCatalog),
  "provider/list": methodFixture("provider/list", {}, modelCatalog),
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
  "apiKey/list": methodFixture("apiKey/list", { providerId }, { apiKeys: [apiKeySummary] }),
  "apiKey/create": methodFixture("apiKey/create", {
    providerId,
    label: "Fixture API Key",
    key: "fixture-secret",
    operationId: "operation:api-key-create",
  }, { apiKey: apiKeySummary }),
  "apiKey/update": methodFixture("apiKey/update", {
    credentialId,
    label: "Updated API Key",
    key: "updated-secret",
    operationId: "operation:api-key-update",
  }, { apiKey: { ...apiKeySummary, label: "Updated API Key" } }),
  "apiKey/setActive": methodFixture("apiKey/setActive", {
    providerId,
    credentialId,
    operationId: "operation:api-key-active",
  }, { apiKey: apiKeySummary }),
  "apiKey/setEnabled": methodFixture("apiKey/setEnabled", {
    credentialId,
    enabled: true,
    operationId: "operation:api-key-enabled",
  }, { apiKey: apiKeySummary }),
  "apiKey/reorder": methodFixture("apiKey/reorder", {
    providerId,
    orderedCredentialIds: [credentialId],
    operationId: "operation:api-key-reorder",
  }, { apiKeys: [apiKeySummary] }),
  "apiKey/test": methodFixture(
    "apiKey/test",
    { credentialId },
    { apiKey: apiKeySummary, ok: true, message: "API Key 可用。" },
  ),
  "apiKey/delete": methodFixture("apiKey/delete", {
    credentialId,
    operationId: "operation:api-key-delete",
  }, { apiKeys: [] }),
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
  "github/auth/status": methodFixture("github/auth/status", {}, githubAuth),
  "github/auth/start": methodFixture("github/auth/start", {
    mode: "device",
  }, githubLogin),
  "github/auth/poll": methodFixture("github/auth/poll", { loginId: "github-login:1" }, githubLogin),
  "github/auth/logout": methodFixture("github/auth/logout", {}, {
    configured: true,
    authenticated: false,
    user: null,
  }),
  "github/profile": methodFixture("github/profile", {}, { user: githubUser }),
  "github/profileOverview": methodFixture("github/profileOverview", {}, {
    overview: githubProfileOverview,
  }),
  "github/repositories": methodFixture("github/repositories", {}, {
    repositories: [githubRepository],
  }),
  "github/pullRequest/read": methodFixture("github/pullRequest/read", {
    owner: "octocat",
    repository: "fixture",
    number: 7,
  }, { pullRequest: githubPullRequest }),
  "github/pullRequest/create": methodFixture("github/pullRequest/create", {
    owner: "octocat",
    repository: "fixture",
    title: "Fixture pull request",
    head: "feature",
    base: "main",
    body: "Fixture body",
    draft: false,
  }, { pullRequest: githubPullRequest }),
  "github/pullRequest/createForProject": methodFixture("github/pullRequest/createForProject", {
    projectId: project.id,
    title: "Fixture pull request",
    body: "Fixture body",
    draft: false,
  }, { pullRequest: githubPullRequest }),
  "github/pullRequest/comment": methodFixture("github/pullRequest/comment", {
    owner: "octocat",
    repository: "fixture",
    number: 7,
    body: "Please fix this.",
    path: "src/index.ts",
    side: "RIGHT",
    line: 1,
    expectedHeadRevision: "head-sha",
    commitId: "head-sha",
  }, {
    comment: {
      id: 1,
      nodeId: "comment-node:1",
      htmlUrl: "https://github.com/octocat/fixture/pull/7#discussion_r1",
      body: "Please fix this.",
    },
  }),
  "github/pullRequest/resolveThread": methodFixture("github/pullRequest/resolveThread", {
    threadId: "review-thread:1",
    resolved: true,
  }, { thread: { id: "review-thread:1", resolved: true } }),
  "github/pullRequest/submitReview": methodFixture("github/pullRequest/submitReview", {
    owner: "octocat",
    repository: "fixture",
    number: 7,
    event: "APPROVE",
    expectedHeadRevision: "head-sha",
  }, {
    review: {
      id: 1,
      state: "APPROVED",
      htmlUrl: "https://github.com/octocat/fixture/pull/7#pullrequestreview-1",
    },
  }),
  "github/push": methodFixture("github/push", {
    projectId: project.id,
    remote: "origin",
    branch: "feature",
  }, {
    remote: "origin",
    branch: "feature",
    repositoryUrl: "https://github.com/octocat/fixture",
    status: {
      branchName: "feature",
      upstream: "origin/feature",
      ahead: 0,
      behind: 0,
      clean: true,
      files: [],
    },
  }),
  "review/summary": methodFixture("review/summary", {
    projectId: project.id,
    source: { kind: "unstaged" },
  }, {
    snapshot: {
      projectId: project.id,
      generation: "generation:1",
      source: { kind: "unstaged" },
      repositoryRoot: "F:\\fixture",
      headSha: "0123456789012345678901234567890123456789",
      baseSha: null,
      files: [],
      totals: { files: 0, additions: 0, deletions: 0, changedLines: 0, changedBytes: 0 },
      largeDiffMode: false,
    },
    cacheState: "stale",
  }),
  "review/fileDiff": methodFixture("review/fileDiff", {
    projectId: project.id,
    source: { kind: "unstaged" },
    generation: "generation:1",
    path: "src/index.ts",
    hideWhitespace: false,
  }, {
    file: {
      path: "src/index.ts",
      previousPath: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      changedLines: 2,
      changedBytes: 32,
      binary: false,
      revision: "revision:1",
    },
    revision: "revision:1",
    patch: "@@ -1 +1 @@\n-old\n+new",
    hunks: [{
      id: "hunk:1",
      header: "@@ -1 +1 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      patch: "@@ -1 +1 @@\n-old\n+new",
    }],
    renderable: true,
    tooLargeReason: null,
  }),
  "review/refresh": methodFixture("review/refresh", {
    projectId: project.id,
    source: { kind: "staged" },
  }, {
    snapshot: {
      projectId: project.id,
      generation: "generation:2",
      source: { kind: "staged" },
      repositoryRoot: "F:\\fixture",
      headSha: null,
      baseSha: null,
      files: [],
      totals: { files: 0, additions: 0, deletions: 0, changedLines: 0, changedBytes: 0 },
      largeDiffMode: false,
    },
    cacheState: "fresh",
  }),
  "review/apply": methodFixture("review/apply", {
    projectId: project.id,
    source: { kind: "unstaged" },
    generation: "generation:1",
    expectedRevision: "revision:1",
    action: "stage",
    target: { kind: "file", path: "src/index.ts" },
    atomic: true,
  }, {
    ok: true,
    action: "stage",
    path: "src/index.ts",
    generation: "generation:2",
  }),
  "review/branches": methodFixture("review/branches", { projectId: project.id }, {
    current: "main",
    branches: [{
      name: "main",
      sha: "0123456789012345678901234567890123456789",
      current: true,
      remote: false,
    }],
  }),
  "review/commits": methodFixture("review/commits", { projectId: project.id, limit: 50 }, {
    commits: [{
      sha: "0123456789012345678901234567890123456789",
      shortSha: "0123456",
      subject: "Fixture commit",
      author: "Fixture author",
      authoredAt: 1,
    }],
  }),
  "review/status": methodFixture("review/status", { projectId: project.id }, {
    status: {
      branchName: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      clean: false,
      files: [{
        path: "src/index.ts",
        previousPath: null,
        stagedStatus: "M",
        unstagedStatus: " ",
        untracked: false,
      }],
    },
  }),
  "review/commit": methodFixture("review/commit", {
    projectId: project.id,
    message: "Update fixture",
    paths: ["src/index.ts"],
  }, {
    ok: true,
    headSha: "0123456789012345678901234567890123456789",
    output: "[main 0123456] Update fixture",
    status: {
      branchName: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      clean: true,
      files: [],
    },
  }),
  "review/comment/list": methodFixture("review/comment/list", {
    threadId: threadListItem.id,
    projectId: project.id,
    sourceKey: "unstaged",
  }, { comments: [] }),
  "review/comment/save": methodFixture("review/comment/save", {
    threadId: threadListItem.id,
    projectId: project.id,
    sourceKey: "unstaged",
    path: "src/index.ts",
    side: "new",
    line: 1,
    hunkId: null,
    revision: "revision:1",
    body: "Please verify this change.",
  }, {
    comment: {
      id: "comment:1",
      threadId: threadListItem.id,
      projectId: project.id,
      sourceKey: "unstaged",
      path: "src/index.ts",
      side: "new",
      line: 1,
      hunkId: null,
      revision: "revision:1",
      body: "Please verify this change.",
      status: "open",
      githubCommentId: null,
      githubThreadId: null,
      createdAt: 1,
      updatedAt: 1,
    },
  }),
  "review/comment/resolve": methodFixture("review/comment/resolve", {
    id: "comment:1",
    threadId: threadListItem.id,
    projectId: project.id,
  }, {
    comment: {
      id: "comment:1",
      threadId: threadListItem.id,
      projectId: project.id,
      sourceKey: "unstaged",
      path: "src/index.ts",
      side: "new",
      line: 1,
      hunkId: null,
      revision: "revision:1",
      body: "Please verify this change.",
      status: "resolved",
      githubCommentId: null,
      githubThreadId: null,
      createdAt: 1,
      updatedAt: 2,
    },
  }),
  "review/comment/delete": methodFixture("review/comment/delete", {
    id: "comment:1",
    threadId: threadListItem.id,
    projectId: project.id,
  }, { ok: true }),
  "review/ai/start": methodFixture("review/ai/start", {
    threadId: threadListItem.id,
    target: { type: "uncommittedChanges" },
    delivery: "inline",
  }, {
    threadId: threadListItem.id,
    turnId: "turn:review:1",
    delivery: "inline",
    source: { kind: "unstaged" },
  }),
  "pet/list": methodFixture("pet/list", {}, {
    pets: [],
  }),
  "pet/catalog/list": methodFixture("pet/catalog/list", {
    refresh: false,
  }, {
    pets: [{
      slug: "sample-pet",
      displayName: "示例宠物",
      englishName: "Sample Pet",
      description: "A sample community pet.",
      author: "CodePilotX",
      category: "original-characters",
      categoryLabel: "原创角色",
      spriteVersionNumber: 2,
      license: "MIT",
      licenseKind: "permissive",
      previewUrl: "/api/pets/catalog/sample-pet/preview",
      installed: false,
    }],
    fetchedAt: "2026-07-24T00:00:00.000Z",
    cacheState: "fresh",
  }),
  "pet/catalog/install": methodFixture("pet/catalog/install", {
    slug: "sample-pet",
    acceptedRestrictedLicense: false,
    operationId: "operation:pet-catalog-install:1",
  }, {
    pet: {
      id: "sample-pet",
      displayName: "Sample Pet",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
      spritesheetUrl: "/api/pets/sample-pet/spritesheet",
      installed: true,
    },
  }),
  "pet/install/preview": methodFixture("pet/install/preview", {
    url: "https://example.com/pet.json",
  }, {
    pet: {
      id: "sample-pet",
      displayName: "Sample Pet",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
      spritesheetUrl: "/api/pets/sample-pet/spritesheet",
      installed: false,
    },
    sourceUrl: "https://example.com/pet.json",
    sizeBytes: 1024,
  }),
  "pet/install": methodFixture("pet/install", {
    url: "https://example.com/pet.json",
    operationId: "operation:pet-install:1",
  }, {
    pet: {
      id: "sample-pet",
      displayName: "Sample Pet",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
      spritesheetUrl: "/api/pets/sample-pet/spritesheet",
      installed: true,
    },
  }),
  "pet/remove": methodFixture("pet/remove", {
    id: "sample-pet",
    operationId: "operation:pet-remove:1",
  }, {
    id: "sample-pet",
    removed: true,
  }),
  "usage/local/get": methodFixture("usage/local/get", {
    range: "30d",
    timeZone: "Asia/Shanghai",
  }, {
    range: "30d",
    timeZone: "Asia/Shanghai",
    generatedAt: 1,
    totals: {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 25,
      totalTokens: 175,
      estimatedCostUsd: "0.0125",
      rootTasks: 1,
      modelResponses: 2,
      providerCalls: 3,
      activeDays: 1,
      currentStreak: 1,
      longestStreak: 1,
    },
    daily: [{
      date: "2026-07-26",
      totals: {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 25,
        totalTokens: 175,
        estimatedCostUsd: "0.0125",
      },
      models: [{
        providerId,
        modelId,
        displayName: "Fixture model",
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 25,
        totalTokens: 175,
        estimatedCostUsd: "0.0125",
        modelResponses: 2,
      }],
    }],
    models: [{
      providerId,
      modelId,
      displayName: "Fixture model",
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 25,
      totalTokens: 175,
      estimatedCostUsd: "0.0125",
      modelResponses: 2,
      sharePercent: 100,
    }],
    heatmap: [{
      date: "2026-07-26",
      totalTokens: 175,
      modelResponses: 2,
    }],
  }),
  "usage/source/list": methodFixture("usage/source/list", {}, {
    sources: [{
      sourceId: "fixture-key",
      canonicalProviderId: providerId,
      providerIds: [providerId],
      displayName: "Fixture provider key",
      scope: "api-key",
      stability: "official",
      availability: "queryable",
      capabilities: ["balance", "quota"],
      queryPolicy: "cached",
      connection: {
        kind: "provider-key",
        credentialId,
        maskedValue: "••••test",
        disconnectible: false,
      },
      connectionMethod: {
        kind: "provider-credential",
      },
    }],
  }),
  "usage/provider/query": methodFixture("usage/provider/query", {
    range: "7d",
    timeZone: "Asia/Shanghai",
    providerIds: [providerId],
    sourceIds: ["fixture-key"],
    force: false,
  }, {
    range: "7d",
    timeZone: "Asia/Shanghai",
    generatedAt: 1,
    sources: [{
      sourceId: "fixture-key",
      providerIds: [providerId],
      displayName: "Fixture provider key",
      scope: "api-key",
      stability: "official",
      status: "available",
      checkedAt: 1,
      connection: {
        kind: "provider-key",
        credentialId,
        maskedValue: "••••test",
        disconnectible: false,
      },
      groups: [{
        id: "account:fixture",
        label: "Fixture account",
        balances: [{
          currency: "USD",
          total: "10.50",
          components: [{ label: "赠送余额", amount: "2.50" }],
        }],
        quotaWindows: [{
          id: "weekly",
          label: "周额度",
          unit: "tokens",
          limit: 1_000,
          used: 250,
          remaining: 750,
          remainingPercent: 75,
          resetsAt: 2,
          state: "normal",
        }],
        totals: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 25,
          requests: 2,
          costs: [{ currency: "USD", amount: "0.0125" }],
        },
        series: [{
          date: "2026-07-26",
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 25,
          requests: 2,
          costs: [{ currency: "USD", amount: "0.0125" }],
        }],
        breakdown: [{
          id: "model:fixture",
          label: "Fixture model",
          kind: "model",
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 25,
          requests: 2,
          costs: [{ currency: "USD", amount: "0.0125" }],
        }],
      }],
    }],
  }),
  "usage/credential/connect": methodFixture("usage/credential/connect", {
    sourceId: "xai-management",
    key: "xai-management-key",
    teamId: "team:fixture",
    operationId: "operation:usage-connect",
  }, {
    sourceId: "xai-management",
    connection: {
      kind: "billing-key",
      credentialId,
      maskedValue: "••••test",
      disconnectible: true,
    },
  }),
  "usage/credential/disconnect": methodFixture("usage/credential/disconnect", {
    sourceId: "xai-management",
    operationId: "operation:usage-disconnect",
  }, {
    sourceId: "xai-management",
    disconnected: true,
  }),
} satisfies MethodFixtures

describe("RPC method schema contracts", () => {
  test("keeps valid params and results for all 147 formal methods decodable", () => {
    const methods = Object.keys(RpcMethods) as RpcMethod[]
    expect(methods).toHaveLength(147)
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
    const decodeThreadHistory = Schema.decodeUnknownSync(RpcMethods["thread/history/read"].params)
    expect(decodeThreadHistory({ threadId: "thread:1" })).toEqual({ threadId: "thread:1" })
    expect(() => decodeThreadHistory({ threadId: "thread:1", limit: 0 })).toThrow()
    expect(() => decodeThreadHistory({ threadId: "thread:1", limit: 51 })).toThrow()

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
    expect(() => Schema.decodeUnknownSync(RpcMethods["turn/interrupt"].params)({
      threadId: threadListItem.id,
      operationId: "operation:turn-interrupt-without-turn",
    })).toThrow()
    expect(() => Schema.decodeUnknownSync(RpcMethods["queue/add"].result)({
      ...fixtures["queue/add"].result,
      admission: "steered",
    })).toThrow()
    const decodeMcpSave = Schema.decodeUnknownSync(
      RpcMethods["mcp/save"].params,
      { onExcessProperty: "error" },
    )
    expect(decodeMcpSave({
      server: {
        name: "fixture",
        scope: "user",
        enabled: true,
        enabledTools: ["", "read"],
        disabledTools: ["write", ""],
        transport: {
          type: "http",
          url: "https://example.com/mcp",
          auth: "none",
          scopes: ["", "profile"],
        },
      },
      operationId: "operation:mcp-save:none",
    })).toMatchObject({
      server: {
        transport: { auth: "none" },
      },
    })
    expect(() => decodeMcpSave({
      server: {
        name: "fixture",
        scope: "user",
        enabled: true,
        transport: {
          type: "http",
          url: "https://example.com/mcp",
          auth: "chatgpt",
        },
      },
      operationId: "operation:mcp-save:invalid-auth",
    })).toThrow()
    const decodeGithubAuthStart = Schema.decodeUnknownSync(
      RpcMethods["github/auth/start"].params,
      { onExcessProperty: "error" },
    )
    expect(decodeGithubAuthStart({ mode: "browser" })).toEqual({ mode: "browser" })
    expect(decodeGithubAuthStart({ mode: "device" })).toEqual({ mode: "device" })
    expect(() => decodeGithubAuthStart({})).toThrow()
    expect(() => decodeGithubAuthStart({ mode: "popup" })).toThrow()
    expect(() => decodeGithubAuthStart({
      mode: "device",
      clientId: "legacy-client-id",
    })).toThrow()
    expect(Schema.decodeUnknownSync(RpcMethods["github/auth/start"].result)({
      ...githubLogin,
      mode: "browser",
      authorizationUrl: "https://github.com/login/oauth/authorize?client_id=fixture",
      userCode: null,
      verificationUri: null,
    })).toMatchObject({
      mode: "browser",
      state: "awaiting_auth",
      authorizationUrl: expect.stringContaining("github.com/login/oauth/authorize"),
    })

    for (const method of ["review/summary", "review/refresh"] as const) {
      const result = fixtures[method].result
      expect(() => Schema.decodeUnknownSync(RpcMethods[method].result)({
        ...result,
        cacheState: "warming",
      }), `${method} cacheState`).toThrow()
      const withoutCacheState = { ...result } as Record<string, unknown>
      delete withoutCacheState.cacheState
      expect(() => Schema.decodeUnknownSync(RpcMethods[method].result)(
        withoutCacheState,
      ), `${method} requires cacheState`).toThrow()
    }
  })

  test("uses explicit FIFO queue methods without reorder or queue-to-steer mutations", () => {
    expect("queue/add" in RpcMethods).toBe(true)
    expect("queue/update" in RpcMethods).toBe(true)
    expect("queue/remove" in RpcMethods).toBe(true)
    expect("queue/resume" in RpcMethods).toBe(true)
    expect("queue/reorder" in RpcMethods).toBe(false)
    expect("queue/steer" in RpcMethods).toBe(false)
  })

  test("accepts bounded deny feedback for approval interactions", () => {
    const decode = Schema.decodeUnknownSync(RpcMethods["interaction/respond"].params)
    const base = {
      interactionId: "interaction:approval",
      expectedVersion: 1,
      operationId: "operation:approval-feedback",
    }
    expect(decode({
      ...base,
      response: { kind: "approval", decision: "deny", feedback: "请改用只读方案" },
    })).toEqual({
      ...base,
      response: { kind: "approval", decision: "deny", feedback: "请改用只读方案" },
    })
    expect(() => decode({
      ...base,
      response: { kind: "approval", decision: "deny", feedback: "x".repeat(4_001) },
    })).toThrow()
  })

  test("accepts explicit project and projectless thread workspaces", () => {
    const decode = Schema.decodeUnknownSync(
      RpcMethods["thread/create"].params,
      { onExcessProperty: "error" },
    )
    const common = {
      title: "Workspace thread",
      operationId: "operation:workspace-thread",
    }

    expect(decode({ ...common, workspace: { kind: "project", projectId: project.id } })).toEqual({
      ...common,
      workspace: { kind: "project", projectId: project.id },
    })
    expect(decode({ ...common, workspace: { kind: "projectless", prompt: "整理需求" } })).toEqual({
      ...common,
      workspace: { kind: "projectless", prompt: "整理需求" },
    })
    expect(() => decode(common)).toThrow()
    expect(() => decode({ ...common, projectId: project.id })).toThrow()
  })

  test("accepts numeric and latest event cursors while rejecting unknown cursor modes", () => {
    const decode = Schema.decodeUnknownSync(RpcMethods["event/subscribe"].params)

    expect(decode({ streams: [{ streamId: "global", after: 0 }] })).toEqual({
      streams: [{ streamId: "global", after: 0 }],
    })
    expect(decode({ streams: [{ streamId: "global", after: "latest" }] })).toEqual({
      streams: [{ streamId: "global", after: "latest" }],
    })
    expect(() => decode({ streams: [{ streamId: "global", after: "newest" }] })).toThrow()
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

    const createParams = Schema.decodeUnknownSync(
      RpcMethods["apiKey/create"].params,
      { onExcessProperty: "error" },
    )(fixtures["apiKey/create"].params)
    expect(createParams.key).toBe("fixture-secret")
    expect(() => Schema.decodeUnknownSync(
      RpcMethods["apiKey/create"].result,
      { onExcessProperty: "error" },
    )({
      ...fixtures["apiKey/create"].result,
      key: "fixture-secret",
    })).toThrow()

    const updateParams = Schema.decodeUnknownSync(
      RpcMethods["apiKey/update"].params,
      { onExcessProperty: "error" },
    )(fixtures["apiKey/update"].params)
    expect(updateParams.key).toBe("updated-secret")
    expect(() => Schema.decodeUnknownSync(
      RpcMethods["apiKey/update"].result,
      { onExcessProperty: "error" },
    )({
      ...fixtures["apiKey/update"].result,
      key: "updated-secret",
    })).toThrow()
  })
})
