import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { ToolExecutor } from "../src/tool/ToolExecutor"
import { WorkspaceService } from "../src/workspace/WorkspaceService"

const paths: string[] = []
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("工作区工具", () => {
  test("普通模式直接应用补丁，Plan 模式拒绝写入", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(root)
    const file = join(root, "source.txt")
    await writeFile(file, "before", "utf8")
    const workspace = await WorkspaceService.open(root)
    const tools = new ToolRegistry()
    const executor = new ToolExecutor(tools)
    const context = { threadID: "thread", turnID: "turn", taskMode: "chat" as const, signal: new AbortController().signal, workspace }

    const patch = await executor.execute("apply_patch", { operation: "update", path: "source.txt", before: "before", after: "after" }, context)
    expect(patch).toMatchObject({ operation: "update", path: "source.txt" })
    expect(await Bun.file(file).text()).toBe("after")
    await expect(executor.execute("apply_patch", { operation: "update", path: "source.txt", before: "after", after: "blocked" }, { ...context, taskMode: "plan" })).rejects.toMatchObject({ code: "WRITE_NOT_ALLOWED_IN_PLAN" })
    expect(await Bun.file(file).text()).toBe("after")
  })

  test("拒绝工作区外路径并以 UTF-8 读取文件", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(parent)
    const root = join(parent, "project")
    await mkdir(root)
    await Bun.write(join(parent, "outside.txt"), "outside")
    await Bun.write(join(root, "utf8.txt"), "中文 UTF-8")
    const workspace = await WorkspaceService.open(root)

    await expect(workspace.read("../outside.txt")).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
    expect(await workspace.read("utf8.txt")).toBe("中文 UTF-8")
  })

  test("拒绝通过符号链接逃离工作区", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(parent)
    const root = join(parent, "project")
    const outside = join(parent, "outside.txt")
    await mkdir(root)
    await writeFile(outside, "secret", "utf8")
    await symlink(outside, join(root, "outside-link.txt"), "file")
    const workspace = await WorkspaceService.open(root)

    await expect(workspace.read("outside-link.txt")).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
  })

  test("统一执行器在第 1 阶段拒绝副作用工具", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const tools = new ToolRegistry()
    tools.register({
      name: "test.side-effect",
      description: "test",
      sideEffect: true,
      inputSchema: { type: "object" },
      execute: async () => "must-not-run",
    })
    const executor = new ToolExecutor(tools)

    await expect(executor.execute("test.side-effect", {}, {
      threadID: "thread",
      turnID: "turn",
      taskMode: "chat",
      signal: new AbortController().signal,
      workspace,
    })).rejects.toMatchObject({ code: "SIDE_EFFECT_TOOLS_DISABLED" })
  })
})
