import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { AgentError } from "../src/domain"
import { ToolExecutor } from "../src/tool/ToolExecutor"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
import type { ToolingResolver, ToolProcessRunner } from "../src/tool/ToolingRuntime"

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const fixture = async (runtime: { resolveTooling?: ToolingResolver; runToolProcess?: ToolProcessRunner } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-core-tools-"))
  temporary.push(root)
  const workspace = await WorkspaceService.open(root)
  const toolingCalls: string[][] = []
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(root, ".agent-data"),
    sandbox: {
      getStatus: async () => ({ state: "available" as const, platform: "win32" as const, architecture: "x64", runtimeVersion: "test", helperPath: null, helperSha256: null, user: null, wfp: null, error: null }),
      refreshStatus: async () => ({ state: "available" as const, platform: "win32" as const, architecture: "x64", runtimeVersion: "test", helperPath: null, helperSha256: null, user: null, wfp: null, error: null }),
      install: async () => undefined,
      uninstall: async () => undefined,
      dispose: async () => undefined,
      run: async () => { throw new Error("not used") },
    },
    authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "test" }),
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
  test("只暴露规范名称，并用同一计划收紧 Skill allowlist", async () => {
    const { executor, context } = await fixture()
    const plan = executor.exposurePlan({ taskMode: "chat", sandboxMode: "workspace-write", profile: "main", allowedTools: ["Read", "workspace_search"] })
    expect(plan.exposed).toEqual(["Read"])
    expect(executor.definition("workspace.read").sdkName).toBe("Read")
    const properties = (name: string) => Object.keys(executor.definition(name).inputSchema.properties as Record<string, unknown>)
    expect(properties("Read")).toEqual(["file_path", "offset", "limit"])
    expect(properties("Write")).toEqual(["file_path", "content"])
    expect(properties("Edit")).toEqual(["file_path", "old_string", "new_string", "replace_all"])
    expect(properties("PowerShell")).toEqual(["command", "timeout", "description"])
    expect(properties("ToolSearch")).toEqual(["query", "max_results"])
    await Bun.write(join(context.workspace.rootPath, "internal.txt"), "internal")
    await expect(executor.execute<any>("workspace.read", { file_path: "internal.txt" }, context).then((result) => result.content)).resolves.toBe("internal")
    expect(() => executor.definition("workspace_read")).toThrow()
    expect(() => executor.definition("shell")).toThrow()
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
