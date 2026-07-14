import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { WorkspaceService } from "../src/workspace/WorkspaceService"

const paths: string[] = []
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("只读工作区工具", () => {
  test("补丁和命令只产生提议，不写文件或执行进程", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(root)
    const file = join(root, "source.txt")
    await writeFile(file, "before", "utf8")
    const tools = new ToolRegistry(await WorkspaceService.open(root))
    const context = { taskMode: "chat" as const, signal: new AbortController().signal }

    const patch = await tools.execute("propose_patch", { path: "source.txt", before: "before", after: "after" }, context)
    const command = await tools.execute("propose_command", { command: "Write-Output should-not-run" }, context)

    expect(patch).toMatchObject({ type: "patch", payload: { path: "source.txt", after: "after" } })
    expect(command).toMatchObject({ type: "command", payload: { command: "Write-Output should-not-run" } })
    expect(await Bun.file(file).text()).toBe("before")
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
})
