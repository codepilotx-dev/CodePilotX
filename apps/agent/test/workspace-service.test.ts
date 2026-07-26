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

describe("WorkspaceService editor files", () => {
  test("只允许精确的用户配置别名，并拒绝别名符号链接重定向", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codepilotx-config-alias-"))
    paths.push(parent)
    const root = join(parent, "project")
    const userConfig = join(parent, "config.toml")
    const redirected = join(parent, "redirected.toml")
    await mkdir(root)
    await writeFile(userConfig, 'model = "gpt-5"\n', "utf8")
    await writeFile(redirected, 'model = "other"\n', "utf8")
    const service = await WorkspaceService.open(root)
    service.grantEditorAlias("@codepilotx/config.toml", userConfig)

    expect(await service.read("@codepilotx/config.toml")).toBe('model = "gpt-5"\n')
    await expect(service.read("@codepilotx/other.toml")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_DENIED",
    })

    const linkedConfig = join(parent, "linked-config.toml")
    await symlink(redirected, linkedConfig, "file")
    const linkedService = await WorkspaceService.open(root)
    linkedService.grantEditorAlias("@codepilotx/config.toml", linkedConfig)
    await expect(linkedService.read("@codepilotx/config.toml")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_DENIED",
    })
  })

  test("只列出指定目录的直接子项并忽略目录与符号链接", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codepilotx-workspace-"))
    paths.push(parent)
    const root = join(parent, "project")
    const outside = join(parent, "outside")
    await mkdir(join(root, "src", "nested"), { recursive: true })
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true })
    await mkdir(outside)
    await writeFile(join(root, "README.md"), "readme", "utf8")
    await writeFile(join(root, "src", "index.ts"), "export {}", "utf8")
    await writeFile(join(root, "src", "nested", "value.ts"), "export const value = 1", "utf8")
    await writeFile(join(root, "node_modules", "ignored", "index.js"), "ignored", "utf8")
    await writeFile(join(outside, "secret.txt"), "secret", "utf8")
    await symlink(outside, join(root, "outside-link"), "dir")
    const service = await WorkspaceService.open(root)

    expect(await service.listEditorFiles(".")).toEqual([
      { name: "src", path: "src", type: "directory", depth: 0 },
      { name: "README.md", path: "README.md", type: "file", depth: 0 },
    ])
    expect(await service.listEditorFiles("src")).toEqual([
      { name: "nested", path: "src/nested", type: "directory", depth: 1 },
      { name: "index.ts", path: "src/index.ts", type: "file", depth: 1 },
    ])
    expect(await service.listEditorFiles("src/nested")).toEqual([
      { name: "value.ts", path: "src/nested/value.ts", type: "file", depth: 2 },
    ])
  })

  test("读取 UTF-8 文件并使用 revision 原子保存", async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, "source.ts"), "const value = 1\n", "utf8")

    const opened = await service.readEditorFile("source.ts")
    expect(opened).toMatchObject({
      path: "source.ts",
      content: "const value = 1\n",
      sizeBytes: 16,
      readonly: false,
    })
    expect(opened.revision.sha256).toBe(hash(opened.content))

    const saved = await service.saveEditorFile("source.ts", "const value = 2\n", opened.revision)
    expect(saved.outcome).toBe("saved")
    expect(await readFile(join(root, "source.ts"), "utf8")).toBe("const value = 2\n")
  })

  test("磁盘内容变化时返回 conflict 且不覆盖", async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, "source.txt"), "before", "utf8")
    const opened = await service.readEditorFile("source.txt")
    await writeFile(join(root, "source.txt"), "external change", "utf8")

    const result = await service.saveEditorFile("source.txt", "local change", opened.revision)

    expect(result.outcome).toBe("conflict")
    expect(await readFile(join(root, "source.txt"), "utf8")).toBe("external change")
  })

  test("超过 10 MiB 的文件只读，并拒绝非法 UTF-8", async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, "large.txt"), Buffer.alloc(10 * 1024 * 1024 + 1, 97))
    await writeFile(join(root, "binary.txt"), new Uint8Array([0xff, 0xfe]))

    const large = await service.readEditorFile("large.txt")
    expect(large.readonly).toBe(true)
    await expect(service.saveEditorFile("large.txt", "small", large.revision)).rejects.toMatchObject({ code: "WORKSPACE_FILE_READONLY" })
    await expect(service.readEditorFile("binary.txt")).rejects.toMatchObject({ code: "WORKSPACE_FILE_UNREADABLE" })
  })

  test("监听文件变化并可显式释放 watcher", async () => {
    const { root, service } = await workspace()
    await writeFile(join(root, "watched.txt"), "before", "utf8")
    const changed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("watch timeout")), 2_000)
      void service.watchEditorFile("watched.txt", (path) => {
        clearTimeout(timeout)
        resolve(path)
      }).then(async (watcher) => {
        await writeFile(join(root, "watched.txt"), "after", "utf8")
        void changed.finally(watcher.close)
      }, reject)
    })

    await expect(changed).resolves.toBe("watched.txt")
  })
})
