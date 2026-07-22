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

    const initial = await executor.execute<any>("Read", { file_path: "source.txt" }, context)
    const patch = await executor.execute("Edit", { file_path: "source.txt", old_string: "before", new_string: "after" }, context)
    expect(patch).toMatchObject({ operation: "edit", path: "source.txt" })
    expect(await Bun.file(file).text()).toBe("after")
    await executor.execute<any>("Read", { file_path: "source.txt" }, context)
    await expect(executor.execute("Edit", { file_path: "source.txt", old_string: "after", new_string: "blocked" }, { ...context, taskMode: "plan" })).rejects.toMatchObject({ code: "TOOL_PERMISSION_DENIED" })
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

  test("ToolCatalog 传递 Read offset/limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(root)
    await Bun.write(join(root, "lines.txt"), "zero\none\ntwo\nthree")
    const workspace = await WorkspaceService.open(root)
    const executor = new ToolExecutor(new ToolRegistry())
    const result = await executor.execute<any>("Read", { file_path: "lines.txt", offset: 1, limit: 2 }, {
      threadID: "thread", turnID: "turn", taskMode: "chat", signal: new AbortController().signal, workspace,
    })
    expect(result.content).toBe("one\ntwo")
  })

  test("Skill allowedTools 在执行器最终边界只能收紧工具", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-skill-tools-"))
    paths.push(root)
    await Bun.write(join(root, "file.txt"), "ok")
    const workspace = await WorkspaceService.open(root)
    const executor = new ToolExecutor(new ToolRegistry())
    const context = {
      threadID: "thread", turnID: "turn", taskMode: "chat" as const,
      signal: new AbortController().signal, workspace, allowedTools: ["Read"],
    }
    await expect(executor.execute<any>("Read", { file_path: "file.txt" }, context).then((result) => result.content)).resolves.toBe("ok")
    await expect(executor.execute("Grep", { path: ".", pattern: "ok" }, context)).rejects.toMatchObject({ code: "SKILL_TOOL_NOT_ALLOWED" })
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

  test("统一执行器最低层拒绝 read-only Write", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const executor = new ToolExecutor(new ToolRegistry())

    await expect(executor.execute("Write", { file_path: "blocked.txt", content: "blocked" }, {
      threadID: "thread",
      turnID: "turn",
      taskMode: "chat",
      signal: new AbortController().signal,
      workspace,
      permissionConfig: { sandboxMode: "read-only", approvalPolicy: "never", approvalsReviewer: "user" },
    })).rejects.toMatchObject({ code: "TOOL_PERMISSION_DENIED" })
  })

  test("已完成的 toolCallId 复用持久结果且不重复副作用", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-tool-idempotency-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const input = { file_path: "once.txt", content: "should-not-run" }
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: root,
      sandbox: {} as never,
      authorizeShell: async () => ({ decision: "allow", risk: "low", reason: "test" }),
      completedToolCall: (id) => id === "call-once" ? { name: "Write", input, output: { reused: true } } : null,
    })

    await expect(executor.execute("Write", input, {
      threadID: "thread", turnID: "turn", toolCallID: "call-once", taskMode: "chat",
      signal: new AbortController().signal, workspace,
    })).resolves.toEqual({ reused: true })
    expect(await Bun.file(join(root, "once.txt")).exists()).toBe(false)
  })

  test("Explorer 不暴露 Shell 且直接调用也在执行器最低层拒绝", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-explorer-"))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const registry = new ToolRegistry()
    expect(registry.list("chat", "workspace-write", "explorer").map((tool) => tool.sdkName)).not.toContain("PowerShell")
    const executor = new ToolExecutor(registry)
    await expect(executor.execute("PowerShell", { command: "Get-ChildItem" }, {
      threadID: "thread", turnID: "turn", profile: "explorer", taskMode: "chat",
      signal: new AbortController().signal, workspace,
    })).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED_FOR_PROFILE" })
  })
})
