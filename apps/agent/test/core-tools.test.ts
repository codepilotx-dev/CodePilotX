import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { AgentError } from "../src/domain"
import { ToolExecutor, type ToolExecutorOptions } from "../src/tool/ToolExecutor"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
import type { ToolingResolver, ToolProcessRunner } from "../src/tool/ToolingRuntime"

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const fixture = async (runtime: {
  resolveTooling?: ToolingResolver
  runToolProcess?: ToolProcessRunner
  authorizeShell?: ToolExecutorOptions["authorizeShell"]
  validateConfigDocument?: ToolExecutorOptions["validateConfigDocument"]
} = {}) => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-core-tools-"))
  temporary.push(root)
  const workspace = await WorkspaceService.open(root)
  const toolingCalls: string[][] = []
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(root, ".agent-data"),
    userConfigPath: join(root, "config.toml"),
    ...(runtime.validateConfigDocument
      ? { validateConfigDocument: runtime.validateConfigDocument }
      : {}),
    sandbox: {
      getStatus: async () => ({ state: "available" as const, platform: "win32" as const, architecture: "x64", runtimeVersion: "test", helperPath: null, helperSha256: null, user: null, wfp: null, error: null }),
      refreshStatus: async () => ({ state: "available" as const, platform: "win32" as const, architecture: "x64", runtimeVersion: "test", helperPath: null, helperSha256: null, user: null, wfp: null, error: null }),
      install: async () => undefined,
      uninstall: async () => undefined,
      dispose: async () => undefined,
      run: async () => { throw new Error("not used") },
    },
    authorizeShell: runtime.authorizeShell
      ?? (async () => ({ decision: "allow", risk: "low", reason: "test" })),
    resolveTooling: runtime.resolveTooling ?? (async (id) => ({ available: true, path: `${id}.exe`, source: "system", version: "test" })),
    runToolProcess: runtime.runToolProcess ?? (async ({ args }) => {
      toolingCalls.push([...args])
      if (args.includes("--files")) return { exitCode: 0, stdout: Buffer.from("alpha.ts\0beta.ts\0"), stderr: "" }
      const pattern = args.at(-2)
      if (pattern === "needle" || pattern === "NEE.*") {
        const line = JSON.stringify({ type: "match", data: { path: { text: "alpha.ts" }, lines: { text: "export const needle = true\n" }, line_number: 1, submatches: [{}] } })
        return { exitCode: 0, stdout: Buffer.from(`${line}\n`), stderr: "" }
      }
      return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "" }
    }),
  })
  const context = { threadID: "thread", turnID: "turn", taskMode: "chat" as const, signal: new AbortController().signal, workspace }
  return { root, workspace, executor, context, toolingCalls }
}

describe("核心工具面", () => {
  test("配置文件写入强制审批并按用户/项目作用域预校验", async () => {
    const reviewed: Array<Record<string, unknown>> = []
    const validated: Array<{ text: string; scope: "user" | "project" }> = []
    const { root, executor, context } = await fixture({
      authorizeShell: async (invocation) => {
        reviewed.push(invocation.input)
        return { decision: "allow", risk: "medium", reason: "approved" }
      },
      validateConfigDocument: (text, scope) => validated.push({ text, scope }),
    })
    await writeFile(join(root, "config.toml"), 'model = "old"\n', "utf8")

    const userAuthorization = await executor.execute<{ decision: string }>(
      "Write",
      { file_path: "@codepilotx/config.toml", content: 'model = "new"\n' },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        },
      },
    )
    expect(userAuthorization.decision).toBe("allow")
    expect(reviewed.at(-1)?.__ruleRequiresApproval).toBe(true)
    expect(validated.at(-1)).toEqual({
      text: 'model = "new"\n',
      scope: "user",
    })

    await executor.execute<{ decision: string }>(
      "Write",
      { file_path: ".codepilotx/config.toml", content: 'model = "project"\n' },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        },
      },
    )
    expect(validated.at(-1)?.scope).toBe("project")
    await expect(executor.execute(
      "Write",
      { file_path: "@codepilotx/config.toml", content: 'model = "blocked"\n' },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          approvalsReviewer: "user",
        },
      },
    )).rejects.toMatchObject({ code: "TOOL_PERMISSION_DENIED" })

    await writeFile(join(root, "config.toml"), 'model = "old"\r\nreasoning = "high"\r\n', "utf8")
    await executor.execute(
      "Edit",
      {
        file_path: "@codepilotx/config.toml",
        old_string: 'model = "old"\nreasoning = "high"',
        new_string: 'model = "new"\nreasoning = "medium"',
      },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        },
      },
    )
    expect(validated.at(-1)).toEqual({
      text: 'model = "new"\r\nreasoning = "medium"\r\n',
      scope: "user",
    })

    await executor.execute("Read", { file_path: "@codepilotx/config.toml" }, context)
    await executor.execute(
      "apply_patch",
      {
        patch: [
          "*** Begin Patch",
          "*** Update File: @codepilotx/config.toml",
          "@@",
          '-model = "old"',
          '+model = "patched"',
          "*** End Patch",
        ].join("\n"),
      },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        },
      },
    )
    expect(validated.at(-1)).toEqual({
      text: 'model = "patched"\r\nreasoning = "high"\r\n',
      scope: "user",
    })
  })

  test("只暴露规范名称，并用同一计划收紧 Skill allowlist", async () => {
    const { executor, context } = await fixture()
    const plan = executor.exposurePlan({ taskMode: "chat", sandboxMode: "workspace-write", profile: "main", allowedTools: ["Read", "workspace_search"] })
    expect(plan.exposed).toEqual(["Read"])
    expect(executor.definition("workspace.read").sdkName).toBe("Read")
    const properties = (name: string) => Object.keys(executor.definition(name).inputSchema.properties as Record<string, unknown>)
    const property = (name: string, key: string) =>
      (executor.definition(name).inputSchema.properties as Record<string, { description?: string }>)[key]
    expect(properties("Read")).toEqual(["file_path", "offset", "limit"])
    expect(properties("apply_patch")).toEqual(["patch"])
    expect(properties("Write")).toEqual(["file_path", "content"])
    expect(properties("Edit")).toEqual(["file_path", "old_string", "new_string", "replace_all"])
    expect(properties("PowerShell")).toEqual(["command", "cwd", "timeout", "description", "additionalPermissions"])
    expect(properties("ToolSearch")).toEqual(["query", "max_results"])
    expect(property("Read", "file_path")?.description).toContain("只接受文件")
    expect(property("Write", "file_path")?.description).toContain("必须先成功 Read")
    expect(property("Edit", "file_path")?.description).toContain("必须先成功 Read")
    expect(property("Glob", "path")?.description).toContain("不得传文件路径")
    expect(property("Grep", "path")?.description).toContain("限制文件范围请使用 glob")
    expect(property("apply_patch", "patch")?.description).toContain("*** Begin Patch")
    expect(property("apply_patch", "patch")?.description).toContain("*** End Patch")
    expect(property("apply_patch", "patch")?.description).toContain("禁止 Markdown 代码围栏")
    await Bun.write(join(context.workspace.rootPath, "internal.txt"), "internal")
    await expect(executor.execute<any>("workspace.read", { file_path: "internal.txt" }, context).then((result) => result.content)).resolves.toBe("internal")
    expect(() => executor.definition("workspace_read")).toThrow()
    expect(() => executor.definition("shell")).toThrow()
    const defaultPlan = executor.exposurePlan({ taskMode: "chat", sandboxMode: "workspace-write", profile: "main" })
    expect(defaultPlan.eager).toContain("apply_patch")
    expect(defaultPlan.eager).not.toContain("Edit")
    expect(defaultPlan.deferred).toContain("Edit")
    const legacySkillPlan = executor.exposurePlan({
      taskMode: "chat",
      sandboxMode: "workspace-write",
      profile: "main",
      allowedTools: ["Edit"],
    })
    expect(legacySkillPlan.exposed).toContain("Edit")
    expect(legacySkillPlan.exposed).not.toContain("apply_patch")
  })

  test("ToolSearch 返回延迟注册表激活提示，进度由定义回调统一上报", async () => {
    const { executor, context } = await fixture()
    const registry = new ToolRegistry()
    registry.register({
      sdkName: "deferred_example",
      description: "延迟示例工具",
      schema: z.object({}).strict(),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      capabilities: { filesystem: "none", network: "none", process: false, externalState: false, userInteraction: false },
      allowedModes: ["chat", "plan"],
      allowedProfiles: ["main", "default", "explorer", "worker"],
      approvalStrategy: "never-review",
      visibility: "deferred",
      executionMode: "parallel",
      execute: async () => ({ ok: true }),
    })
    const searchable = new ToolExecutor(registry)
    const result = await searchable.execute<any>("ToolSearch", { query: "select:deferred_example" }, context)
    expect(result.addedToolNames).toEqual(["deferred_example"])

    const progress: unknown[] = []
    await Bun.write(join(context.workspace.rootPath, "progress.txt"), "ok")
    await executor.execute("Read", { file_path: "progress.txt" }, { ...context, onProgress: (item) => progress.push(item) })
    expect(progress).toEqual([{ message: "正在读取 progress.txt" }])
  })

  test("Read 返回快照，Write 和 Edit 拒绝陈旧快照", async () => {
    const { root, executor, context } = await fixture()
    await writeFile(join(root, "source.txt"), "before", "utf8")
    const read = await executor.execute<any>("Read", { file_path: "source.txt" }, context)
    expect(read).toMatchObject({ content: "before", snapshot: { sha256: expect.any(String) } })

    await writeFile(join(root, "source.txt"), "changed elsewhere", "utf8")
    await expect(executor.execute("Write", { file_path: "source.txt", content: "overwrite" }, context)).rejects.toMatchObject({ code: "WORKSPACE_FILE_STALE" })
    await expect(executor.execute("Edit", { file_path: "source.txt", old_string: "changed", new_string: "edited" }, context)).rejects.toMatchObject({ code: "WORKSPACE_FILE_STALE" })
  })

  test("Edit replace_all 使用执行器快照替换全部匹配", async () => {
    const { root, executor, context } = await fixture()
    await writeFile(join(root, "replace.txt"), "x x x", "utf8")
    await executor.execute("Read", { file_path: "replace.txt" }, context)
    await executor.execute("Edit", { file_path: "replace.txt", old_string: "x", new_string: "y", replace_all: true }, context)
    expect(await Bun.file(join(root, "replace.txt")).text()).toBe("y y y")
  })

  test("Edit 将 Read 返回的换行上下文应用到 CRLF 文件并保持原换行", async () => {
    const { root, executor, context } = await fixture()
    const path = join(root, "crlf.txt")
    await writeFile(path, "alpha\r\nbeta\r\n--\r\nalpha\r\nbeta\r\n", "utf8")
    await executor.execute("Read", { file_path: "crlf.txt" }, context)
    await executor.execute(
      "Edit",
      {
        file_path: "crlf.txt",
        old_string: "alpha\nbeta",
        new_string: "gamma\ndelta",
        replace_all: true,
      },
      context,
    )
    expect(await Bun.file(path).text()).toBe("gamma\r\ndelta\r\n--\r\ngamma\r\ndelta\r\n")
  })

  test("Edit 不会把裸 LF 精确命中到 CRLF 的中间位置", async () => {
    const { root, executor, context } = await fixture()
    const path = join(root, "crlf-boundary.txt")
    await writeFile(path, "a\r\nb\r\n", "utf8")
    await executor.execute("Read", { file_path: "crlf-boundary.txt" }, context)
    await executor.execute(
      "Edit",
      { file_path: "crlf-boundary.txt", old_string: "\nb", new_string: "\nc" },
      context,
    )
    expect(await Bun.file(path).text()).toBe("a\r\nc\r\n")
  })

  test("Read 与 Edit 使用同一文件的绝对和相对路径时共享快照", async () => {
    const { root, executor, context } = await fixture()
    const path = join(root, "source.txt")
    await writeFile(path, "before", "utf8")
    await executor.execute("Read", { file_path: path }, context)
    await executor.execute("Edit", { file_path: "source.txt", old_string: "before", new_string: "after" }, context)
    expect(await Bun.file(path).text()).toBe("after")
  })

  test("apply_patch 在一次调用中新增并更新文件，保留 BOM/CRLF 并刷新多文件快照", async () => {
    const { root, executor, context } = await fixture()
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const source = join(root, "source.txt")
    await writeFile(source, Buffer.concat([bom, Buffer.from("alpha\r\nbefore\r\nomega\r\n", "utf8")]))
    await executor.execute("Read", { file_path: "source.txt" }, context)

    const result = await executor.execute<any>("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: source.txt",
        "@@",
        "-before",
        "+after",
        "*** Add File: created.txt",
        "+created",
        "*** End Patch",
      ].join("\n"),
    }, context)

    expect(result).toMatchObject({
      operation: "apply_patch",
      files: [
        { operation: "update", path: "source.txt" },
        { operation: "create", path: "created.txt" },
      ],
      summary: { fileCount: 2, hunkCount: 1, additions: 2, deletions: 1 },
    })
    expect(await Bun.file(source).arrayBuffer().then((value) => Buffer.from(value))).toEqual(
      Buffer.concat([bom, Buffer.from("alpha\r\nafter\r\nomega\r\n", "utf8")]),
    )
    expect(await Bun.file(join(root, "created.txt")).text()).toBe("created\n")

    await executor.execute("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: source.txt",
        "@@",
        "-after",
        "+again",
        "*** End Patch",
      ].join("\n"),
    }, context)
    expect(await Bun.file(source).arrayBuffer().then((value) => Buffer.from(value))).toEqual(
      Buffer.concat([bom, Buffer.from("alpha\r\nagain\r\nomega\r\n", "utf8")]),
    )
  })

  test("apply_patch 任一 Update 缺少 Read 快照时整批零写入", async () => {
    const { root, executor, context } = await fixture()
    await writeFile(join(root, "first.txt"), "first\n", "utf8")
    await writeFile(join(root, "second.txt"), "second\n", "utf8")
    await executor.execute("Read", { file_path: "first.txt" }, context)

    await expect(executor.execute("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: first.txt",
        "@@",
        "-first",
        "+changed-first",
        "*** Update File: second.txt",
        "@@",
        "-second",
        "+changed-second",
        "*** End Patch",
      ].join("\n"),
    }, context)).rejects.toMatchObject({ code: "WORKSPACE_FILE_STALE" })

    expect(await Bun.file(join(root, "first.txt")).text()).toBe("first\n")
    expect(await Bun.file(join(root, "second.txt")).text()).toBe("second\n")
  })

  test("apply_patch 任一受保护目标会让整批进入审批并投影全部安全路径", async () => {
    const reviewed: any[] = []
    const { root, executor, context } = await fixture({
      authorizeShell: async (invocation) => {
        reviewed.push(invocation)
        return { decision: "allow", risk: "high", reason: "approved" }
      },
    })
    await mkdir(join(root, ".git", "hooks"), { recursive: true })
    await mkdir(join(root, "vendor", "repo", ".git", "hooks"), { recursive: true })

    const result = await executor.execute<any>("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Add File: normal.txt",
        "+normal",
        "*** Add File: .git/hooks/pre-commit",
        "+hook",
        "*** Add File: vendor/repo/.git/hooks/pre-push",
        "+nested-hook",
        "*** End Patch",
      ].join("\n"),
    }, {
      ...context,
      authorizationOnly: true,
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
    })

    expect(result).toMatchObject({
      decision: "allow",
      authorizationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(reviewed.at(-1)?.authorizationScope).toMatchObject({
      ruleRequiresApproval: true,
      affectedPaths: [
          { operation: "create", path: "normal.txt" },
          { operation: "create", path: ".git/hooks/pre-commit" },
          { operation: "create", path: "vendor/repo/.git/hooks/pre-push" },
        ],
    })
    expect(await Bun.file(join(root, "normal.txt")).exists()).toBe(false)
    expect(await Bun.file(join(root, ".git", "hooks", "pre-commit")).exists()).toBe(false)
    expect(await Bun.file(join(root, "vendor", "repo", ".git", "hooks", "pre-push")).exists()).toBe(false)
  })

  test("apply_patch 在 .git 目录被用作工作区根时仍强制整批审批", async () => {
    const reviewed: any[] = []
    const { root, executor, context } = await fixture({
      authorizeShell: async (invocation) => {
        reviewed.push(invocation)
        return { decision: "allow", risk: "high", reason: "approved" }
      },
    })
    const gitRoot = join(root, ".git")
    const hooksRoot = join(gitRoot, "hooks")
    await mkdir(hooksRoot, { recursive: true })
    const permissionConfig = {
      sandboxMode: "workspace-write" as const,
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "user" as const,
    }

    const gitWorkspace = await WorkspaceService.open(gitRoot)
    await executor.execute("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Add File: normal.txt",
        "+normal",
        "*** Add File: hooks/pre-commit",
        "+hook",
        "*** End Patch",
      ].join("\n"),
    }, {
      ...context,
      workspace: gitWorkspace,
      authorizationOnly: true,
      permissionConfig,
    })
    expect(reviewed.at(-1)?.authorizationScope).toMatchObject({
      ruleRequiresApproval: true,
      affectedPaths: [
        { operation: "create", path: "normal.txt" },
        { operation: "create", path: "hooks/pre-commit" },
      ],
    })

    const multiRootWorkspace = await WorkspaceService.openRoots({
      primaryRoot: root,
      roots: [
        { path: root, role: "primary" },
        { folderId: "git-hooks", path: hooksRoot, role: "secondary" },
      ],
    })
    await executor.execute("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Add File: workspace-normal.txt",
        "+normal",
        `*** Add File: ${join(hooksRoot, "pre-push")}`,
        "+hook",
        "*** End Patch",
      ].join("\n"),
    }, {
      ...context,
      workspace: multiRootWorkspace,
      authorizationOnly: true,
      permissionConfig,
    })
    expect(reviewed.at(-1)?.authorizationScope).toMatchObject({
      ruleRequiresApproval: true,
      affectedPaths: [
        { operation: "create", path: "workspace-normal.txt" },
        { operation: "create", path: "@workspace/git-hooks/pre-push" },
      ],
    })
  })

  test("apply_patch 快照失效失败不会遮蔽原始部分提交错误", async () => {
    const { root, workspace, executor, context } = await fixture()
    const target = join(root, "source.txt")
    await writeFile(target, "before\n", "utf8")
    await executor.execute("Read", { file_path: "source.txt" }, context)
    workspace.commitEditorMutations = async () => {
      await rm(target, { force: true })
      await mkdir(target)
      throw new AgentError("PATCH_PARTIAL_COMMIT", "内部部分提交错误", 500, {
        committed: ["source.txt"],
        pending: [],
      })
    }

    const error = await executor.execute("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: source.txt",
        "@@",
        "-before",
        "+after",
        "*** End Patch",
      ].join("\n"),
    }, context).catch((cause) => cause)

    expect(error).toBeInstanceOf(AgentError)
    if (!(error instanceof AgentError)) throw error
    expect(error.code).toBe("PATCH_PARTIAL_COMMIT")
    expect(error.details).toEqual({ committed: ["source.txt"], pending: [] })
    expect(error.message).not.toContain(root)
  })

  test("Glob 与 Grep 有界返回，Shell schema 禁止后台和绕过参数", async () => {
    const { root, executor, context, toolingCalls } = await fixture()
    await Bun.write(join(root, "alpha.ts"), "export const needle = true")
    await Bun.write(join(root, "beta.ts"), "export const other = true")
    const glob = await executor.execute<any>("Glob", { pattern: "*.ts", limit: 1 }, context)
    expect(glob.matches).toHaveLength(1)
    expect(glob.truncated).toBe(true)
    expect(glob.engine).toBe("ripgrep")
    const grep = await executor.execute<any>("Grep", { pattern: "needle", head_limit: 1 }, context)
    expect(grep.matches).toHaveLength(1)
    expect(grep.engine).toBe("ripgrep")
    const regex = await executor.execute<any>("Grep", { pattern: "NEE.*", "-i": true, output_mode: "files_with_matches", glob: "*.ts" }, context)
    expect(regex.files).toEqual(["alpha.ts"])
    expect(toolingCalls[0]).toEqual(["--files", "--null", "--color", "never", "--sort", "path", "--glob", "*.ts", "--", "."])
    expect(toolingCalls[2]).toContain("--ignore-case")
    expect(toolingCalls[2]).toContain("--glob")
    await expect(executor.execute("PowerShell", { command: "Get-Date", run_in_background: true }, context)).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" })
    await expect(executor.execute("Bash", { command: "pwd", dangerouslyDisableSandbox: true }, context)).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" })
  })

  test("Glob/Grep 接受工作区内绝对路径并拒绝越界", async () => {
    const { root, executor, context, toolingCalls } = await fixture()
    await Bun.write(join(root, "alpha.ts"), "export const needle = true")
    await executor.execute("Glob", { pattern: "*.ts", path: root }, context)
    expect(toolingCalls.at(-1)?.at(-1)).toBe(".")

    const outside = await mkdtemp(join(tmpdir(), "codepilotx-core-tools-outside-"))
    temporary.push(outside)
    await expect(executor.execute("Glob", { pattern: "*.ts", path: outside }, context)).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
    await expect(executor.execute("Glob", { pattern: "*.ts", path: "../outside" }, context)).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
  })

  test("未指定路径时 Glob/Grep 搜索所有项目根并区分附加目录结果", async () => {
    const resolveTooling: ToolingResolver = async () => ({ available: false, code: "SYSTEM_TOOL_NOT_FOUND", reason: "未找到 ripgrep" })
    const { root, executor, context } = await fixture({ resolveTooling })
    const secondary = await mkdtemp(join(tmpdir(), "codepilotx-core-tools-secondary-"))
    temporary.push(secondary)
    await Bun.write(join(root, "primary.ts"), "export const needle = 'primary'")
    await Bun.write(join(secondary, "secondary.ts"), "export const needle = 'secondary'")
    const workspace = await WorkspaceService.openRoots({
      primaryRoot: root,
      roots: [
        { path: root, role: "primary" },
        { path: secondary, role: "secondary" },
      ],
    })

    const glob = await executor.execute<any>("Glob", { pattern: "*.ts" }, { ...context, workspace })
    expect(glob.matches).toEqual(["primary.ts", join(secondary, "secondary.ts")].sort((left, right) => left.localeCompare(right)))
    const grep = await executor.execute<any>("Grep", { pattern: "needle", output_mode: "files_with_matches" }, { ...context, workspace })
    expect(grep.files).toEqual(["primary.ts", join(secondary, "secondary.ts")])
  })

  test("ripgrep 不可用时 Glob/Grep 使用有界原生降级", async () => {
    const resolveTooling: ToolingResolver = async () => ({ available: false, code: "SYSTEM_TOOL_NOT_FOUND", reason: "未找到 ripgrep" })
    const runToolProcess: ToolProcessRunner = async () => { throw new Error("原生降级不得启动 ripgrep") }
    const { root, executor, context } = await fixture({ resolveTooling, runToolProcess })
    await mkdir(join(root, "src"))
    await Bun.write(join(root, "Main.java"), "class Main {\n  String value = \"needle\";\n}\n")
    await Bun.write(join(root, "other.txt"), "needle\n")
    await Bun.write(join(root, "src", "Nested.java"), "class Nested {}\n")

    const glob = await executor.execute<any>("Glob", { pattern: "**/*.{java,txt}" }, context)
    expect(glob).toMatchObject({
      matches: ["Main.java", "other.txt", "src/Nested.java"],
      engine: "native-fallback",
    })

    const grep = await executor.execute<any>("Grep", {
      pattern: "NEE.*",
      "-i": true,
      type: "java",
      context: 1,
    }, context)
    expect(grep.engine).toBe("native-fallback")
    expect(grep.matches).toEqual([{
      path: "Main.java",
      line: 2,
      text: "  String value = \"needle\";",
      before: ["class Main {"],
      after: ["}"],
    }])
  })

  test("原生 Grep 对未知 ripgrep type 明确拒绝", async () => {
    const resolveTooling: ToolingResolver = async () => ({ available: false, code: "TOOLING_UNAVAILABLE", reason: "下载失败" })
    const { executor, context } = await fixture({ resolveTooling })
    await expect(executor.execute("Grep", { pattern: "needle", type: "unknown-language" }, context)).rejects.toMatchObject({
      code: "WORKSPACE_SEARCH_FALLBACK_UNSUPPORTED",
    })
  })

  test("ripgrep 解析取消和进程启动后的错误均不触发原生降级", async () => {
    const abortedResolver: ToolingResolver = async () => ({ available: false, code: "TOOLING_ABORTED", reason: "已取消" })
    const aborted = await fixture({ resolveTooling: abortedResolver })
    await expect(aborted.executor.execute("Glob", { pattern: "*.ts" }, aborted.context)).rejects.toMatchObject({ code: "RUN_ABORTED" })

    let processCalls = 0
    const runToolProcess: ToolProcessRunner = async () => {
      processCalls += 1
      throw new AgentError("WORKSPACE_SEARCH_TIMEOUT", "ripgrep 超时", 408)
    }
    const started = await fixture({ runToolProcess })
    await Bun.write(join(started.root, "would-match.ts"), "needle")
    await expect(started.executor.execute("Grep", { pattern: "needle" }, started.context)).rejects.toMatchObject({
      code: "WORKSPACE_SEARCH_TIMEOUT",
    })
    expect(processCalls).toBe(1)
  })
})
