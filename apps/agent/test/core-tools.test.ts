import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { ToolExecutor } from "../src/tool/ToolExecutor"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { WorkspaceService } from "../src/workspace/WorkspaceService"

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-core-tools-"))
  temporary.push(root)
  const workspace = await WorkspaceService.open(root)
  const executor = new ToolExecutor(new ToolRegistry())
  const context = { threadID: "thread", turnID: "turn", taskMode: "chat" as const, signal: new AbortController().signal, workspace }
  return { root, workspace, executor, context }
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
    const { root, executor, context } = await fixture()
    await Bun.write(join(root, "alpha.ts"), "export const needle = true")
    await Bun.write(join(root, "beta.ts"), "export const other = true")
    const glob = await executor.execute<any>("Glob", { pattern: "*.ts", limit: 1 }, context)
    expect(glob.matches).toHaveLength(1)
    expect(glob.truncated).toBe(true)
    const grep = await executor.execute<any>("Grep", { pattern: "needle", head_limit: 1 }, context)
    expect(grep.matches).toHaveLength(1)
    const regex = await executor.execute<any>("Grep", { pattern: "NEE.*", "-i": true, output_mode: "files_with_matches", glob: "*.ts" }, context)
    expect(regex.files).toEqual(["alpha.ts"])
    await expect(executor.execute("PowerShell", { command: "Get-Date", run_in_background: true }, context)).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" })
    await expect(executor.execute("Bash", { command: "pwd", dangerouslyDisableSandbox: true }, context)).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" })
  })
})
