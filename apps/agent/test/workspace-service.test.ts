import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceService } from "../src/workspace/WorkspaceService"

const paths: string[] = []
const hash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex")

afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const workspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
  paths.push(root)
  return { root, service: await WorkspaceService.open(root) }
}

describe("WorkspaceService.applyPatch", () => {
  test("更新唯一上下文并返回 diff、行数和哈希", async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, "source.txt"), "first\nbefore\nlast", "utf8")

    const result = await service.applyPatch({ operation: "update", path: "source.txt", before: "before", after: "after\nnext" })

    expect(await readFile(join(root, "source.txt"), "utf8")).toBe("first\nafter\nnext\nlast")
    expect(result).toMatchObject({ operation: "update", path: "source.txt", additions: 2, deletions: 1 })
    expect(result.diff).toContain("--- a/source.txt\n+++ b/source.txt\n@@ -2,1 +2,2 @@\n-before\n+after\n+next")
    expect(result.beforeSha256).toBe(hash("first\nbefore\nlast"))
    expect(result.afterSha256).toBe(hash("first\nafter\nnext\nlast"))
  })

  test("创建新文件并按预期哈希删除", async () => {
    const { root, service } = await workspace()

    const created = await service.applyPatch({ operation: "create", path: "created.txt", content: "中文\ncontent" })
    expect(await readFile(join(root, "created.txt"), "utf8")).toBe("中文\ncontent")
    expect(created).toMatchObject({ operation: "create", additions: 2, deletions: 0, beforeSha256: null, afterSha256: hash("中文\ncontent") })
    expect(created.diff).toStartWith("--- /dev/null\n+++ b/created.txt")

    const deleted = await service.applyPatch({ operation: "delete", path: "created.txt", expectedSha256: hash("中文\ncontent") })
    expect(await Bun.file(join(root, "created.txt")).exists()).toBe(false)
    expect(deleted).toMatchObject({ operation: "delete", additions: 0, deletions: 2, beforeSha256: hash("中文\ncontent"), afterSha256: null })
    expect(deleted.diff).toStartWith("--- a/created.txt\n+++ /dev/null")
  })

  test("拒绝重复上下文、覆盖创建和哈希不匹配", async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, "source.txt"), "same same", "utf8")

    await expect(service.applyPatch({ operation: "update", path: "source.txt", before: "same", after: "next" })).rejects.toMatchObject({ code: "PATCH_CONTEXT_AMBIGUOUS" })
    await expect(service.applyPatch({ operation: "create", path: "source.txt", content: "next" })).rejects.toMatchObject({ code: "WORKSPACE_PATH_EXISTS" })
    await expect(service.applyPatch({ operation: "delete", path: "source.txt", expectedSha256: hash("different") })).rejects.toMatchObject({ code: "PATCH_SHA256_MISMATCH" })
    expect(await readFile(join(root, "source.txt"), "utf8")).toBe("same same")
  })

  test("将重叠出现的 before 视为不唯一", async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, "overlap.txt"), "aaa", "utf8")

    await expect(service.applyPatch({ operation: "update", path: "overlap.txt", before: "aa", after: "next" })).rejects.toMatchObject({ code: "PATCH_CONTEXT_AMBIGUOUS" })
    expect(await readFile(join(root, "overlap.txt"), "utf8")).toBe("aaa")
  })

  test("拒绝绝对路径、遍历和通过符号链接逃逸", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(parent)
    const root = join(parent, "project")
    const outside = join(parent, "outside")
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(outside, "secret.txt"), "secret", "utf8")
    await symlink(outside, join(root, "outside-link"), "dir")
    const service = await WorkspaceService.open(root)

    await expect(service.applyPatch({ operation: "create", path: join(root, "absolute.txt"), content: "no" })).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
    await expect(service.applyPatch({ operation: "create", path: "sub/../traversal.txt", content: "no" })).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
    await expect(service.applyPatch({ operation: "update", path: "outside-link/secret.txt", before: "secret", after: "leaked" })).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
    await expect(service.applyPatch({ operation: "create", path: "outside-link/new.txt", content: "leaked" })).rejects.toMatchObject({ code: "WORKSPACE_PATH_DENIED" })
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret")
    expect(await Bun.file(join(outside, "new.txt")).exists()).toBe(false)
  })
})
