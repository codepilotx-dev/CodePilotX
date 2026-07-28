import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitReviewService } from "../src/review/GitReviewService"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (path) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(path, { recursive: true, force: true })
        return
      } catch (cause) {
        if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
        await Bun.sleep(100)
      }
    }
  }))
})

const git = async (cwd: string, ...args: string[]) => {
  const child = Bun.spawn(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`)
  return stdout.trim()
}

const fixture = async (options: {
  onChanged?: (projectId: string) => void | Promise<void>
  onGitCommand?: (args: readonly string[]) => void
  resolvePullRequest?: (input: {
    workspaceRoot: string
    owner: string
    repository: string
    number: number
  }) => Promise<{ baseSha: string; headSha: string }>
} = {}) => {
  const container = await mkdtemp(join(tmpdir(), "codepilotx-review-"))
  roots.push(container)
  const root = join(container, "repository")
  await mkdir(root)
  await git(root, "init", "-b", "main")
  await git(root, "config", "user.name", "CodePilotX Test")
  await git(root, "config", "user.email", "test@codepilotx.local")
  await mkdir(join(root, "src"))
  await writeFile(join(root, "src", "index.ts"), "export const value = 1\n", "utf8")
  await git(root, "add", ".")
  await git(root, "commit", "-m", "initial")
  const db = new AgentDatabase(join(container, "agent.sqlite"))
  const project = db.createProject({ rootPath: root })
  const thread = db.createThread("Review fixture", project.id)
  return {
    root,
    db,
    project,
    thread,
    review: new GitReviewService(
      db,
      options.onChanged,
      options.resolvePullRequest,
      options.onGitCommand,
    ),
  }
}

describe("GitReviewService", () => {
  test("读取项目当前工作分支", async () => {
    const { root, db, project, review } = await fixture()
    await git(root, "switch", "-c", "codex/hover-card")

    expect(await review.currentBranch(project.id)).toBe("codex/hover-card")
    db.close()
  })

  test("生成未暂存摘要和文件级 hunk，并保护过期快照", async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(join(root, "src", "index.ts"), "export const value = 2\nexport const added = true\n", "utf8")

    const snapshot = await review.summary(project.id, { kind: "unstaged" })
    expect(snapshot.files).toHaveLength(1)
    expect(snapshot.files[0]).toMatchObject({
      path: "src/index.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
    })
    expect(snapshot.largeDiffMode).toBe(false)

    const diff = await review.fileDiff({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: snapshot.generation,
      path: "src/index.ts",
    })
    expect(diff.renderable).toBe(true)
    expect(diff.patch).toContain("+export const value = 2")
    expect(diff.hunks).toHaveLength(1)

    await writeFile(join(root, "src", "index.ts"), "export const value = 3\n", "utf8")
    await expect(review.fileDiff({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: snapshot.generation,
      path: "src/index.ts",
    })).rejects.toMatchObject({ code: "REVIEW_SNAPSHOT_EXPIRED" })
    db.close()
  }, 30_000)

  test("暂存、取消暂存和恢复文件使用 generation/revision 乐观锁", async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(join(root, "src", "index.ts"), "export const value = 2\n", "utf8")

    const unstaged = await review.summary(project.id, { kind: "unstaged" })
    const unstagedDiff = await review.fileDiff({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: unstaged.generation,
      path: "src/index.ts",
    })
    await review.apply({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: unstaged.generation,
      expectedRevision: unstagedDiff.revision,
      action: "stage",
      target: { kind: "file", path: "src/index.ts" },
    })
    expect((await review.summary(project.id, { kind: "unstaged" })).files).toHaveLength(0)

    const staged = await review.summary(project.id, { kind: "staged" })
    const stagedDiff = await review.fileDiff({
      projectId: project.id,
      source: { kind: "staged" },
      generation: staged.generation,
      path: "src/index.ts",
    })
    await review.apply({
      projectId: project.id,
      source: { kind: "staged" },
      generation: staged.generation,
      expectedRevision: stagedDiff.revision,
      action: "unstage",
      target: { kind: "file", path: "src/index.ts" },
    })

    const restoredSource = await review.summary(project.id, { kind: "unstaged" })
    const restoredDiff = await review.fileDiff({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: restoredSource.generation,
      path: "src/index.ts",
    })
    await review.apply({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: restoredSource.generation,
      expectedRevision: restoredDiff.revision,
      action: "revert",
      target: { kind: "file", path: "src/index.ts" },
    })
    expect((await Bun.file(join(root, "src", "index.ts")).text()).replaceAll("\r\n", "\n")).toBe("export const value = 1\n")
    db.close()
  }, 30_000)

  test("读取工作区状态并仅提交经过验证的仓库内路径", async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(join(root, "src", "index.ts"), "export const value = 2\n", "utf8")
    await writeFile(join(root, "src", "new.ts"), "export const added = true\n", "utf8")

    const before = await review.status(project.id)
    expect(before).toMatchObject({
      branchName: "main",
      clean: false,
    })
    expect(before.files.map((file) => file.path).sort()).toEqual([
      "src/index.ts",
      "src/new.ts",
    ])
    const branchSnapshot = await review.summary(project.id, {
      kind: "branch",
      baseBranch: "main",
    })
    expect(branchSnapshot.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/index.ts", status: "modified" }),
        expect.objectContaining({ path: "src/new.ts", status: "untracked" }),
      ]),
    )

    const committed = await review.commit({
      projectId: project.id,
      message: "review fixture commit",
      paths: ["src/index.ts", "src/new.ts"],
    })
    expect(committed.ok).toBe(true)
    expect(committed.headSha).toHaveLength(40)
    expect(committed.status.clean).toBe(true)
    expect(await git(root, "log", "-1", "--format=%s")).toBe("review fixture commit")

    await expect(review.commit({
      projectId: project.id,
      message: "invalid path",
      paths: ["../outside.txt"],
    })).rejects.toMatchObject({ code: "PATH_DENIED" })
    db.close()
  }, 30_000)

  test("列出本地分支和提交，并拒绝未接入的 PR 来源", async () => {
    const { db, project, review } = await fixture()
    const branches = await review.branches(project.id)
    expect(branches.current).toBe("main")
    expect(branches.branches.some((branch) => branch.name === "main" && branch.current)).toBe(true)
    const commits = await review.commits(project.id)
    expect(commits.commits[0]?.subject).toBe("initial")
    await expect(review.summary(project.id, {
      kind: "pull-request",
      owner: "codepilotx",
      repository: "fixture",
      number: 1,
    })).rejects.toMatchObject({ code: "REVIEW_SOURCE_UNAVAILABLE" })
    db.close()
  }, 30_000)

  test("Git 暂态不会生成相互矛盾的 Review generation", async () => {
    const { root, db, project, review } = await fixture()
    const mergeHead = await git(root, "rev-parse", "--git-path", "MERGE_HEAD")
    await writeFile(join(root, mergeHead), `${"a".repeat(40)}\n`, "utf8")

    await expect(review.summary(project.id, { kind: "unstaged" })).rejects.toMatchObject({
      code: "REVIEW_SOURCE_UNAVAILABLE",
      status: 503,
      details: { operation: "merge" },
    })
    db.close()
  }, 30_000)

  test("批量摘要的 Git 子进程数量不随文件数增长，文件加载不会重跑摘要", async () => {
    const commands: string[][] = []
    const { root, db, project, review } = await fixture({
      onGitCommand: (args) => commands.push([...args]),
    })
    for (let index = 0; index < 50; index += 1) {
      await writeFile(
        join(root, "src", `bulk-${index}.ts`),
        `export const value${index} = ${index}\n`,
        "utf8",
      )
    }
    await git(root, "add", ".")
    await git(root, "commit", "-m", "bulk fixture")
    for (let index = 0; index < 50; index += 1) {
      await writeFile(
        join(root, "src", `bulk-${index}.ts`),
        `export const value${index} = ${index + 1}\n`,
        "utf8",
      )
    }

    commands.length = 0
    const snapshot = await review.summary(project.id, { kind: "unstaged" })
    expect(snapshot.files).toHaveLength(50)
    expect(commands.length).toBeLessThanOrEqual(8)
    expect(commands.filter((args) => args.includes("--numstat"))).toHaveLength(1)
    expect(commands.filter((args) => args.includes("--name-status"))).toHaveLength(1)

    const commandCountAfterSummary = commands.length
    await Promise.all(snapshot.files.slice(0, 5).map((file) => review.fileDiff({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: snapshot.generation,
      path: file.path,
    })))
    expect(commands).toHaveLength(commandCountAfterSummary)
    db.close()
  }, 30_000)

  test("相同摘要刷新和文件 Diff 的并发请求会合并", async () => {
    const commands: string[][] = []
    const { root, db, project, review } = await fixture({
      onGitCommand: (args) => commands.push([...args]),
    })
    await writeFile(join(root, "src", "index.ts"), "export const value = 2\n", "utf8")

    const [first, second] = await Promise.all([
      review.summaryResult(project.id, { kind: "unstaged" }, true),
      review.summaryResult(project.id, { kind: "unstaged" }, true),
    ])
    expect(first.snapshot.generation).toBe(second.snapshot.generation)
    expect(first.cacheState).toBe("fresh")
    expect(commands.filter((args) => args.includes("--name-status"))).toHaveLength(1)

    commands.length = 0
    const input = {
      projectId: project.id,
      source: { kind: "unstaged" } as const,
      generation: first.snapshot.generation,
      path: "src/index.ts",
      hideWhitespace: true,
    }
    const [firstDiff, secondDiff] = await Promise.all([
      review.fileDiff(input),
      review.fileDiff(input),
    ])
    expect(firstDiff).toEqual(secondDiff)
    expect(commands.filter((args) => args[0] === "diff")).toHaveLength(1)
    db.close()
  }, 30_000)

  test("未暂存摘要遵循原生 git diff，未跟踪文件暂存后进入已暂存来源", async () => {
    const { root, db, project, review } = await fixture()
    await writeFile(
      join(root, "src", "index.ts"),
      "export const value = 2\nexport const tracked = true\n",
      "utf8",
    )
    await writeFile(
      join(root, "src", "untracked.ts"),
      "export const first = true\nexport const second = true\n",
      "utf8",
    )

    const nativeNumstat = await git(root, "diff", "--numstat")
    const [nativeAdditions, nativeDeletions] = nativeNumstat.split("\t").map(Number)
    const snapshot = await review.summary(project.id, { kind: "unstaged" })
    expect(snapshot.files.map((file) => file.path)).toEqual(["src/index.ts"])
    expect(snapshot.totals).toMatchObject({
      files: 1,
      additions: nativeAdditions,
      deletions: nativeDeletions,
    })
    await expect(review.fileDiff({
      projectId: project.id,
      source: { kind: "unstaged" },
      generation: snapshot.generation,
      path: "src/untracked.ts",
    })).rejects.toMatchObject({
      code: "REVIEW_SOURCE_UNAVAILABLE",
      status: 404,
    })

    await git(root, "add", "--", "src/untracked.ts")
    const staged = await review.summary(project.id, { kind: "staged" })
    expect(staged.files).toEqual([
      expect.objectContaining({
        path: "src/untracked.ts",
        status: "added",
        additions: 2,
        deletions: 0,
      }),
    ])
    expect(staged.totals).toMatchObject({ files: 1, additions: 2, deletions: 0 })
    db.close()
  }, 30_000)

  test("本地分支来源不准备远端，PR 来源继续走现有远端准备器", async () => {
    let pullRequestPreparations = 0
    const { db, project, review } = await fixture({
      resolvePullRequest: async () => {
        pullRequestPreparations += 1
        return {
          baseSha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
          headSha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
        }
      },
    })

    await review.summary(project.id, { kind: "branch", baseBranch: "main" })
    expect(pullRequestPreparations).toBe(0)
    await review.summary(project.id, {
      kind: "pull-request",
      owner: "codepilotx",
      repository: "fixture",
      number: 1,
    })
    expect(pullRequestPreparations).toBe(1)
    db.close()
  }, 30_000)

  test("watcher 仅标记旧快照 stale，refresh 再返回新 generation", async () => {
    let resolveChanged: (() => void) | undefined
    const changed = new Promise<void>((resolve) => {
      resolveChanged = resolve
    })
    let changedCalls = 0
    const { root, db, project, review } = await fixture({
      onChanged: () => {
        changedCalls += 1
        resolveChanged?.()
      },
    })
    const initial = await review.summaryResult(project.id, { kind: "unstaged" })
    await writeFile(join(root, "src", "index.ts"), "export const value = 2\n", "utf8")
    await Promise.race([
      changed,
      Bun.sleep(3_000).then(() => {
        throw new Error("等待 Git watcher 超时")
      }),
    ])

    const stale = await review.summaryResult(project.id, { kind: "unstaged" })
    expect(stale.cacheState).toBe("stale")
    expect(stale.snapshot.generation).toBe(initial.snapshot.generation)
    const refreshed = await review.summaryResult(project.id, { kind: "unstaged" }, true)
    expect(refreshed.cacheState).toBe("fresh")
    expect(refreshed.snapshot.generation).not.toBe(initial.snapshot.generation)
    expect(changedCalls).toBe(1)
    review.dispose()
    db.close()
  }, 30_000)

  test("watcher 合并事件风暴并忽略 gitignored 文件", async () => {
    let changedCalls = 0
    let resolveChanged: (() => void) | undefined
    const changed = new Promise<void>((resolve) => {
      resolveChanged = resolve
    })
    const { root, db, project, review } = await fixture({
      onChanged: () => {
        changedCalls += 1
        resolveChanged?.()
      },
    })
    await writeFile(join(root, ".gitignore"), "ignored.log\n", "utf8")
    await git(root, "add", ".gitignore")
    await git(root, "commit", "-m", "ignore fixture")
    await review.summaryResult(project.id, { kind: "unstaged" })

    await writeFile(join(root, "ignored.log"), "ignored\n", "utf8")
    await Bun.sleep(600)
    expect(changedCalls).toBe(0)

    await Promise.all(Array.from({ length: 10 }, (_, index) =>
      writeFile(join(root, "src", "index.ts"), `export const value = ${index}\n`, "utf8")))
    await Promise.race([
      changed,
      Bun.sleep(3_000).then(() => {
        throw new Error("等待合并后的 Git watcher 事件超时")
      }),
    ])
    await Bun.sleep(600)
    expect(changedCalls).toBe(1)
    review.dispose()
    db.close()
  }, 30_000)

  test("评论按 Thread/项目隔离，并保存最近一轮 tree 快照", async () => {
    const { root, db, project, thread, review } = await fixture()
    const turn = db.createTurn(thread.id, {
      content: "fixture",
      model: { providerID: "fixture" as never, id: "fixture" as never },
      permissionConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
      strategy: "queue",
      taskMode: "chat",
    })
    const tree = await git(root, "write-tree")
    db.saveTurnGitSnapshot({
      threadId: thread.id,
      turnId: turn.turnID,
      projectId: project.id,
      repositoryRoot: root,
      beforeTree: tree,
      afterTree: tree,
    })
    expect(db.getTurnGitSnapshot(thread.id, turn.turnID)).toMatchObject({ beforeTree: tree, afterTree: tree })

    const comment = review.saveComment({
      threadId: thread.id,
      projectId: project.id,
      sourceKey: "unstaged",
      path: "src/index.ts",
      side: "new",
      line: 1,
      hunkId: null,
      revision: "revision",
      body: "检查这一行",
    })
    expect(review.listComments({ threadId: thread.id, projectId: project.id, sourceKey: "unstaged" })).toHaveLength(1)
    expect(review.saveComment({
      id: comment.id,
      threadId: thread.id,
      projectId: project.id,
      sourceKey: "unstaged",
      path: "src/index.ts",
      side: "new",
      line: 1,
      hunkId: null,
      revision: "revision",
      body: "检查这一行",
      githubCommentId: "123",
    }).githubCommentId).toBe("123")
    expect(review.resolveComment({ id: comment.id, threadId: thread.id, projectId: project.id }).status).toBe("resolved")
    expect(review.deleteComment({ id: comment.id, threadId: thread.id, projectId: project.id })).toEqual({ ok: true })
    db.close()
  }, 30_000)
})
