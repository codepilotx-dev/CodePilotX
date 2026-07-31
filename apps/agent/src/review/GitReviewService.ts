import { createHash } from "node:crypto"
import { watch as watchFileSystem, type FSWatcher } from "node:fs"
import { lstat, mkdtemp, readlink, realpath, rm, stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import type {
  ReviewApplyBatchResult,
  ReviewApplyResult,
  ReviewComment,
  ReviewFileDiffResult,
  ReviewFileSummary,
  ReviewSource,
  ReviewSummaryResult,
  ReviewSummarySnapshot,
} from "@codepilotx/agent-protocol"
import { AgentError } from "../domain"
import { GitCommandRunner, type GitCommandResult } from "../git/GitCommandRunner"
import type { AgentLogger } from "../observability/AgentLogger"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import {
  normalizedPath,
  parseHunks,
  parseNameStatus,
  parseNumstat,
  parseNumstats,
  parsePorcelainStatus,
  sha256,
  textFilePatch,
  validateRelativePath,
} from "./diff/parsers"
import { fileState } from "./state/file-state"
import { reviewSourceKey } from "./source/source-key"

const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024
const GIT_TIMEOUT_MS = 20_000
const LARGE_FILE_COUNT = 128
const LARGE_CHANGED_LINES = 9_000
const LARGE_CHANGED_BYTES = 12 * 1024 * 1024
const UNRENDERABLE_CHANGED_LINES = 15_000
const UNRENDERABLE_CHANGED_BYTES = 3 * 1024 * 1024
const UNRENDERABLE_LINE_BYTES = 1 * 1024 * 1024
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const decoder = new TextDecoder("utf-8", { fatal: true })
type ResolvedSource = {
  source: ReviewSource
  args: string[]
  headSha: string | null
  baseSha: string | null
}
type PatchScanSection = {
  patch: string | null
  revision: string
  changedBytes: number
}
type CachedReviewSnapshot = {
  rootPath: string
  gitDirectory: string
  resolved: ResolvedSource
  snapshot: ReviewSummarySnapshot
  patches: Map<string, string>
  worktreeStates: Map<string, string>
  indexState: string
  fileDiffs: Map<string, ReviewFileDiffResult>
  fileDiffRequests: Map<string, Promise<ReviewFileDiffResult>>
  stale: boolean
}
type ProjectWatcher = {
  close: () => void
}
type ReviewLogger = Pick<AgentLogger, "info" | "warn" | "error">
type ReviewSnapshotPhase =
  | "repository"
  | "source"
  | "pre-scan"
  | "diff-scan"
  | "post-scan"
  | "finalize"

export class GitReviewService {
  private readonly watchers = new Map<string, ProjectWatcher>()
  private readonly watcherRequests = new Map<string, Promise<void>>()
  private readonly snapshots = new Map<string, CachedReviewSnapshot>()
  private readonly snapshotRequests = new Map<string, Promise<CachedReviewSnapshot>>()
  private readonly projectEpochs = new Map<string, number>()
  private readonly repositoryRoots = new Map<string, string>()
  private readonly dirtyProjects = new Set<string>()
  private disposed = false
  private readonly gitRunner: GitCommandRunner

  constructor(
    private readonly db: AgentDatabase,
    private readonly onChanged?: ((projectId: string) => void | Promise<void>) | undefined,
    private readonly resolvePullRequest?: ((input: {
      workspaceRoot: string
      owner: string
      repository: string
      number: number
    }) => Promise<{ baseSha: string; headSha: string }>) | undefined,
    private readonly onGitCommand?: ((args: readonly string[]) => void) | undefined,
    private readonly logger?: ReviewLogger | undefined,
  ) {
    this.gitRunner = new GitCommandRunner({
      maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
      timeoutMs: GIT_TIMEOUT_MS,
      onCommand: this.onGitCommand,
    })
  }

  private reviewFailureDetails(cause: unknown) {
    const record = cause && typeof cause === "object"
      ? cause as { code?: unknown; status?: unknown }
      : null
    return {
      errorName: cause instanceof Error ? cause.name : "UnknownError",
      code: typeof record?.code === "string" ? record.code : undefined,
      status: typeof record?.status === "number" ? record.status : undefined,
      message: cause instanceof Error ? cause.message : String(cause),
    }
  }

  dispose() {
    this.disposed = true
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.watcherRequests.clear()
  }

  private async git(
    cwd: string,
    args: readonly string[],
    input?: string,
    acceptedCodes: readonly number[] = [0],
    env?: Readonly<Record<string, string>>,
    literalPathspecs = false,
  ): Promise<GitCommandResult> {
    return this.gitRunner.run({
      cwd,
      args,
      input,
      acceptedCodes,
      env,
      literalPathspecs,
    })
  }

  private async scanPatch(cwd: string, args: readonly string[]): Promise<PatchScanSection[]> {
    const sections: PatchScanSection[] = []
    let retainPatches = true
    let totalBytes = 0
    let current: {
      chunks: string[]
      hash: ReturnType<typeof createHash>
      changedBytes: number
    } | null = null

    const finalize = () => {
      if (!current) return
      sections.push({
        patch: retainPatches ? current.chunks.join("") : null,
        revision: current.hash.digest("hex"),
        changedBytes: current.changedBytes,
      })
      current = null
    }
    const consume = (value: string) => {
      if (value.startsWith("diff --git ")) {
        finalize()
        current = {
          chunks: [],
          hash: createHash("sha256"),
          changedBytes: 0,
        }
      }
      if (!current) return
      const byteLength = Buffer.byteLength(value, "utf8")
      totalBytes += byteLength
      current.changedBytes += byteLength
      current.hash.update(value, "utf8")
      if (retainPatches && totalBytes <= LARGE_CHANGED_BYTES) {
        current.chunks.push(value)
      } else if (retainPatches) {
        retainPatches = false
        current.chunks.length = 0
        for (const section of sections) section.patch = null
      }
    }

    const output = await this.git(cwd, args, undefined, [0, 1])
    for (const line of output.stdout.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      consume(line)
    }
    finalize()
    return sections
  }

  private async repository(projectId: string) {
    const project = this.db.getProject(projectId)
    if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
    const cachedRoot = this.repositoryRoots.get(projectId)
    if (cachedRoot) {
      void this.ensureWatcher(projectId, cachedRoot)
      return { project, rootPath: cachedRoot }
    }
    const rootResult = await this.git(project.rootPath, ["rev-parse", "--show-toplevel"], undefined, [0, 128]).catch((cause) => {
      if (cause instanceof AgentError && cause.code === "GIT_COMMAND_FAILED") {
        throw new AgentError("REPOSITORY_NOT_FOUND", "项目不在 Git 仓库中", 404)
      }
      throw cause
    })
    if (rootResult.code !== 0 || !rootResult.stdout.trim()) throw new AgentError("REPOSITORY_NOT_FOUND", "项目不在 Git 仓库中", 404)
    const rootPath = await realpath(resolve(rootResult.stdout.trim()))
    const projectRoot = await realpath(resolve(project.rootPath))
    const containment = relative(projectRoot, rootPath)
    if (containment.startsWith("..") || isAbsolute(containment)) {
      throw new AgentError("PATH_DENIED", "Git 仓库根目录超出已注册项目边界", 403)
    }
    this.repositoryRoots.set(projectId, rootPath)
    void this.ensureWatcher(projectId, rootPath)
    return { project, rootPath }
  }

  private async ensureWatcher(projectId: string, rootPath: string) {
    if (!this.onChanged || this.disposed || this.watchers.has(projectId)) return
    const active = this.watcherRequests.get(projectId)
    if (active) return active
    const request = this.installWatcher(projectId, rootPath).catch(() => undefined)
    this.watcherRequests.set(projectId, request)
    try {
      await request
    } finally {
      if (this.watcherRequests.get(projectId) === request) {
        this.watcherRequests.delete(projectId)
      }
    }
  }

  private async installWatcher(projectId: string, rootPath: string) {
    let debounce: ReturnType<typeof setTimeout> | undefined
    let maxWait: ReturnType<typeof setTimeout> | undefined
    let unknownPath = false
    let metadataChanged = false
    let closed = false
    const pendingPaths = new Set<string>()
    const watchers = new Set<FSWatcher>()
    const close = () => {
      if (closed) return
      closed = true
      if (debounce) clearTimeout(debounce)
      if (maxWait) clearTimeout(maxWait)
      debounce = undefined
      maxWait = undefined
      pendingPaths.clear()
      for (const watcher of watchers) watcher.close()
      watchers.clear()
      if (this.watchers.get(projectId)?.close === close) {
        this.watchers.delete(projectId)
      }
    }
    const flush = async () => {
      if (debounce) clearTimeout(debounce)
      if (maxWait) clearTimeout(maxWait)
      debounce = undefined
      maxWait = undefined
      const paths = [...pendingPaths]
      pendingPaths.clear()
      try {
        const invalidate = metadataChanged
          || unknownPath
          || await this.shouldInvalidateWatchPaths(rootPath, paths)
        if (!invalidate || closed) return
        this.markProjectStale(projectId)
        if (this.dirtyProjects.has(projectId)) return
        this.dirtyProjects.add(projectId)
        await Promise.resolve(this.onChanged?.(projectId)).catch(() => undefined)
      } catch {
        // Watcher reconciliation is advisory; explicit refresh remains usable.
      } finally {
        unknownPath = false
        metadataChanged = false
      }
    }
    const schedule = () => {
      if (closed) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        void flush().catch(() => undefined)
      }, 250)
      maxWait ??= setTimeout(() => {
        void flush().catch(() => undefined)
      }, 1_000)
    }
    const addWatcher = (
      path: string,
      onEvent: (filename: string | null) => void,
    ) => {
      if (closed) return false
      try {
        const watcher = watchFileSystem(
          path,
          { persistent: false, recursive: true },
          (_event, filename) => {
            try {
              onEvent(filename == null ? null : normalizedPath(filename.toString()))
              schedule()
            } catch {
              // A malformed watcher event must not escape the callback boundary.
            }
          },
        )
        watchers.add(watcher)
        watcher.on("error", () => {
          watcher.close()
          watchers.delete(watcher)
        })
        return true
      } catch {
        return false
      }
    }

    this.watchers.set(projectId, { close })
    addWatcher(rootPath, (filename) => {
      if (filename == null) unknownPath = true
      else pendingPaths.add(filename)
    })
    if (this.disposed || closed) {
      close()
      return
    }

    const metadataResults = await Promise.allSettled([
      this.git(rootPath, ["rev-parse", "--absolute-git-dir"]).then((result) => result.stdout.trim()),
      this.git(rootPath, ["rev-parse", "--git-common-dir"]).then((result) => result.stdout.trim()),
    ])
    const metadataDirectories = new Set<string>()
    for (const result of metadataResults) {
      if (result.status !== "fulfilled" || !result.value) continue
      const absolute = isAbsolute(result.value) ? resolve(result.value) : resolve(rootPath, result.value)
      metadataDirectories.add(await realpath(absolute).catch(() => absolute))
    }
    for (const directory of metadataDirectories) {
      addWatcher(directory, (filename) => {
        if (filename == null || this.isRelevantGitMetadataPath(filename)) {
          metadataChanged = true
        }
      })
    }
    if (this.disposed) {
      close()
    }
  }

  private isRelevantGitMetadataPath(path: string) {
    const normalized = normalizedPath(path).replace(/^\.\/+/, "")
    return normalized === "HEAD"
      || normalized === "index"
      || normalized === "packed-refs"
      || normalized === "MERGE_HEAD"
      || normalized === "CHERRY_PICK_HEAD"
      || normalized === "REVERT_HEAD"
      || normalized.startsWith("refs/")
      || normalized.startsWith("rebase-")
      || normalized.startsWith("sequencer/")
  }

  private async shouldInvalidateWatchPaths(rootPath: string, paths: readonly string[]) {
    if (paths.length === 0) return false
    const worktreePaths: string[] = []
    for (const path of paths) {
      const relativePath = isAbsolute(path) ? relative(rootPath, path) : path
      const normalized = normalizedPath(relativePath).replace(/^\.\/+/, "")
      if (!normalized) return true
      if (normalized === ".git" || normalized.startsWith(".git/")) {
        const gitPath = normalized.slice(5)
        if (
          gitPath === "HEAD"
          || gitPath === "index"
          || gitPath.startsWith("refs/")
          || gitPath === "MERGE_HEAD"
          || gitPath === "CHERRY_PICK_HEAD"
          || gitPath === "REVERT_HEAD"
          || gitPath.startsWith("rebase-")
        ) return true
        continue
      }
      worktreePaths.push(normalized)
    }
    if (worktreePaths.length === 0) return false
    const ignored = await this.git(
      rootPath,
      ["check-ignore", "-z", "--stdin"],
      `${worktreePaths.join("\0")}\0`,
      [0, 1],
      undefined,
      false,
    )
    const ignoredPaths = new Set(
      ignored.stdout.split("\0").filter(Boolean).map(normalizedPath),
    )
    return worktreePaths.some((path) => !ignoredPaths.has(path))
  }

  private markProjectStale(projectId: string) {
    this.projectEpochs.set(projectId, (this.projectEpochs.get(projectId) ?? 0) + 1)
    for (const [key, entry] of this.snapshots) {
      if (!key.startsWith(`${projectId}\0`)) continue
      entry.stale = true
    }
  }

  private async assertStableRepositoryState(rootPath: string, knownGitDirectory?: string) {
    const rawGitDirectory = knownGitDirectory
      ? null
      : await this.optionalGit(rootPath, ["rev-parse", "--git-dir"])
    const gitDirectory = knownGitDirectory
      ?? (rawGitDirectory && (isAbsolute(rawGitDirectory)
        ? rawGitDirectory
        : resolve(rootPath, rawGitDirectory)))
    if (!gitDirectory) return rootPath
    const operations = [
      ["MERGE_HEAD", "merge"],
      ["CHERRY_PICK_HEAD", "cherry-pick"],
      ["REVERT_HEAD", "revert"],
      ["rebase-merge", "rebase"],
      ["rebase-apply", "rebase"],
    ] as const
    for (const [marker, operation] of operations) {
      const markerPath = resolve(gitDirectory, marker)
      if (await stat(markerPath).catch(() => null)) {
        throw new AgentError(
          "REVIEW_SOURCE_UNAVAILABLE",
          `Git 正在执行 ${operation}，完成或中止后再刷新审阅。`,
          503,
          { operation },
        )
      }
    }
    return gitDirectory
  }

  async captureTurnSnapshot(input: {
    projectId: string
    threadId: string
    turnId: string
    phase: "before" | "after"
  }) {
    const { rootPath } = await this.repository(input.projectId)
    const temporary = await mkdtemp(join(tmpdir(), "codepilotx-review-index-"))
    const indexPath = join(temporary, "index")
    const env = { GIT_INDEX_FILE: indexPath }
    try {
      const head = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
      if (head) await this.git(rootPath, ["read-tree", "HEAD"], undefined, [0], env)
      else await this.git(rootPath, ["read-tree", "--empty"], undefined, [0], env)
      await this.git(rootPath, ["add", "-A"], undefined, [0], env)
      const tree = (await this.git(rootPath, ["write-tree"], undefined, [0], env)).stdout.trim()
      const snapshotRef = `refs/codepilotx/review/${input.threadId}/${input.turnId}/${input.phase}`
      const validRef = await this.git(rootPath, ["check-ref-format", snapshotRef], undefined, [0, 1])
      if (validRef.code !== 0) {
        throw new AgentError("INVALID_REQUEST", "Review 快照标识无法写入 Git 引用", 400)
      }
      await this.git(rootPath, ["update-ref", snapshotRef, tree])
      this.db.saveTurnGitSnapshot({
        threadId: input.threadId,
        turnId: input.turnId,
        projectId: input.projectId,
        repositoryRoot: rootPath,
        ...(input.phase === "before" ? { beforeTree: tree } : { afterTree: tree }),
      })
      return tree
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  prepareThreadSnapshotCleanup(threadId: string): () => Promise<void> {
    const rows = this.db.sqlite.query(`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM threads WHERE id = ?
        UNION ALL
        SELECT child.id
        FROM threads AS child
        JOIN subtree AS parent ON child.parent_thread_id = parent.id
      )
      SELECT snapshot.thread_id, snapshot.turn_id, snapshot.repository_root,
             snapshot.before_tree, snapshot.after_tree
      FROM turn_git_snapshots AS snapshot
      JOIN subtree ON subtree.id = snapshot.thread_id
    `).all(threadId) as Array<{
      thread_id: string
      turn_id: string
      repository_root: string
      before_tree: string | null
      after_tree: string | null
    }>

    return async () => {
      for (const row of rows) {
        for (const phase of ["before", "after"] as const) {
          if (phase === "before" ? !row.before_tree : !row.after_tree) continue
          const ref =
            `refs/codepilotx/review/${row.thread_id}/${row.turn_id}/${phase}`
          await this.git(
            row.repository_root,
            ["update-ref", "-d", ref],
            undefined,
            [0, 1, 128],
          ).catch(() => undefined)
        }
      }
    }
  }

  private async optionalGit(cwd: string, args: readonly string[]) {
    const result = await this.git(cwd, args, undefined, [0, 1, 128])
    return result.code === 0 ? result.stdout.trim() || null : null
  }

  private gitPaths(
    cwd: string,
    args: readonly string[],
    paths: readonly string[],
    acceptedCodes: readonly number[] = [0],
  ) {
    return this.git(
      cwd,
      [...args, "--pathspec-from-file=-", "--pathspec-file-nul"],
      `${paths.join("\0")}\0`,
      acceptedCodes,
      undefined,
      true,
    )
  }

  async currentBranch(projectId: string): Promise<string | null> {
    const { rootPath } = await this.repository(projectId)
    return this.optionalGit(rootPath, ["branch", "--show-current"])
  }

  private async resolveSource(projectId: string, rootPath: string, source: ReviewSource): Promise<ResolvedSource> {
    const headSha = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
    switch (source.kind) {
      case "unstaged":
        return { source, args: [], headSha, baseSha: null }
      case "staged":
        return { source, args: ["--cached"], headSha, baseSha: headSha }
      case "branch": {
        if (!headSha) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "空仓库无法与基础分支比较", 409)
        const baseSha = await this.optionalGit(rootPath, ["merge-base", source.baseBranch, "HEAD"])
        if (!baseSha) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", `无法解析基础分支 ${source.baseBranch}`, 404)
        return { source, args: [baseSha], headSha, baseSha }
      }
      case "commit": {
        const line = await this.optionalGit(rootPath, ["rev-list", "--parents", "-n", "1", source.commitSha])
        if (!line) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "指定提交不存在", 404)
        const [commitSha, parentSha] = line.split(/\s+/)
        return {
          source,
          args: [parentSha ?? EMPTY_TREE_SHA, commitSha!],
          headSha,
          baseSha: parentSha ?? null,
        }
      }
      case "last-turn": {
        const snapshot = this.db.getTurnGitSnapshot(source.threadId, source.turnId)
        if (!snapshot?.beforeTree || !snapshot.afterTree) {
          throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "最近一轮没有可用的 Git 快照", 404)
        }
        const snapshotRoot = await realpath(resolve(snapshot.repositoryRoot)).catch(() => null)
        if (snapshot.projectId !== projectId || snapshotRoot !== rootPath) {
          throw new AgentError("PROJECT_SCOPE_MISMATCH", "最近一轮 Git 快照不属于当前项目", 409)
        }
        return {
          source,
          args: [snapshot.beforeTree, snapshot.afterTree],
          headSha,
          baseSha: snapshot.beforeTree,
        }
      }
      case "pull-request": {
        if (!this.resolvePullRequest) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "GitHub PR 来源尚未连接", 501)
        const comparison = await this.resolvePullRequest({
          workspaceRoot: rootPath,
          owner: source.owner,
          repository: source.repository,
          number: source.number,
        })
        return {
          source,
          args: [comparison.baseSha, comparison.headSha],
          headSha: comparison.headSha,
          baseSha: comparison.baseSha,
        }
      }
    }
    throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "未知 Review 来源", 400)
  }

  private async rawPatch(rootPath: string, resolved: ResolvedSource, path: string, hideWhitespace = false) {
    const common = ["diff", "--binary", "--no-ext-diff", "--no-color", "--full-index", ...(hideWhitespace ? ["-w"] : [])]
    const tracked = await this.git(
      rootPath,
      [...common, ...resolved.args, "--", path],
      undefined,
      [0, 1],
      undefined,
      true,
    )
    if (tracked.stdout) return tracked.stdout
    if (resolved.source.kind === "branch") {
      return (await this.untrackedFile(rootPath, path))?.patch ?? ""
    }
    return ""
  }

  private async safeUntrackedEntry(rootPath: string, path: string) {
    const absolute = resolve(rootPath, validateRelativePath(path))
    const containment = relative(rootPath, absolute)
    if (containment.startsWith("..") || isAbsolute(containment)) {
      throw new AgentError("PATH_DENIED", "文件超出仓库边界", 403)
    }
    const metadata = await lstat(absolute).catch((cause) => {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return null
      throw cause
    })
    if (!metadata) return null
    if (metadata.isSymbolicLink()) {
      return {
        kind: "symlink" as const,
        target: await readlink(absolute, "utf8"),
      }
    }
    if (!metadata.isFile()) return null
    const canonical = await realpath(absolute)
    const canonicalContainment = relative(rootPath, canonical)
    if (canonicalContainment.startsWith("..") || isAbsolute(canonicalContainment)) {
      throw new AgentError("PATH_DENIED", "文件的真实路径超出仓库边界", 403)
    }
    return { kind: "file" as const, path: canonical }
  }

  private symlinkPatch(path: string, target: string) {
    const normalizedTarget = target.replaceAll("\r\n", "\n")
    const lines = normalizedTarget.split("\n")
    const patch = [
      `diff --git a/${path} b/${path}`,
      "new file mode 120000",
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      "\\ No newline at end of file",
      "",
    ].join("\n")
    return {
      patch,
      additions: lines.length,
      binary: false,
      changedBytes: Buffer.byteLength(patch, "utf8"),
      revision: sha256(`symlink\0${target}`),
    }
  }

  private async untrackedFile(rootPath: string, path: string) {
    const entry = await this.safeUntrackedEntry(rootPath, path)
    if (!entry) return null
    if (entry.kind === "symlink") return this.symlinkPatch(path, entry.target)
    const file = Bun.file(entry.path)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const binary = bytes.includes(0)
    if (binary) {
      const patch = [
        `diff --git a/${path} b/${path}`,
        "new file mode 100644",
        `Binary files /dev/null and b/${path} differ`,
        "",
      ].join("\n")
      return { patch, additions: null, binary: true }
    }
    let content: string
    try {
      content = decoder.decode(bytes)
    } catch {
      const patch = [
        `diff --git a/${path} b/${path}`,
        "new file mode 100644",
        `Binary files /dev/null and b/${path} differ`,
        "",
      ].join("\n")
      return { patch, additions: null, binary: true }
    }
    const generated = textFilePatch(path, content)
    return { ...generated, binary: false }
  }

  private async scanUntrackedFile(rootPath: string, path: string) {
    const entry = await this.safeUntrackedEntry(rootPath, path)
    if (!entry) return null
    if (entry.kind === "symlink") return this.symlinkPatch(path, entry.target)
    const file = Bun.file(entry.path)
    const reader = file.stream().getReader()
    const contentHash = createHash("sha256")
    const streamDecoder = new TextDecoder("utf-8", { fatal: true })
    const chunks: string[] = []
    let binary = false
    let retainContent = true
    let byteLength = 0
    let newlineCount = 0
    let endsWithNewline = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        byteLength += value.byteLength
        contentHash.update(value)
        if (value.includes(0)) binary = true
        if (binary) {
          retainContent = false
          chunks.length = 0
          continue
        }
        try {
          const text = streamDecoder.decode(value, { stream: true })
          newlineCount += text.match(/\n/g)?.length ?? 0
          if (text.length > 0) endsWithNewline = text.endsWith("\n")
          if (retainContent && byteLength <= LARGE_CHANGED_BYTES) chunks.push(text)
          else {
            retainContent = false
            chunks.length = 0
          }
        } catch {
          binary = true
          retainContent = false
          chunks.length = 0
        }
      }
      if (!binary) {
        try {
          const tail = streamDecoder.decode()
          if (tail) {
            newlineCount += tail.match(/\n/g)?.length ?? 0
            endsWithNewline = tail.endsWith("\n")
            if (retainContent) chunks.push(tail)
          }
        } catch {
          binary = true
          retainContent = false
          chunks.length = 0
        }
      }
    } finally {
      reader.releaseLock()
    }
    const revision = contentHash.digest("hex")
    if (binary) {
      return {
        patch: null,
        additions: null,
        binary: true,
        changedBytes: byteLength,
        revision,
      }
    }
    const additions = newlineCount + (byteLength > 0 && !endsWithNewline ? 1 : 0)
    const patch = retainContent ? textFilePatch(path, chunks.join("")).patch : null
    return {
      patch,
      additions,
      binary: false,
      changedBytes: patch === null ? byteLength : Buffer.byteLength(patch, "utf8"),
      revision,
    }
  }

  private async buildFileSummaries(rootPath: string, resolved: ResolvedSource) {
    const common = ["diff", "--binary", "--no-ext-diff", "--no-color", "--full-index"]
    const names = parseNameStatus(
      (await this.git(rootPath, ["diff", "--name-status", "-z", "--find-renames", ...resolved.args])).stdout,
    )
    const trackedEntries = [...names]
    const numstats = parseNumstats(
      (await this.git(rootPath, ["diff", "--numstat", "-z", ...resolved.args])).stdout,
    )
    const patchSections = await this.scanPatch(rootPath, [...common, ...resolved.args])
    const patches = new Map<string, string>()
    const patchMetadata = new Map<string, PatchScanSection>()
    for (const [index, entry] of trackedEntries.entries()) {
      const section = patchSections[index] ?? {
        patch: "",
        revision: sha256(""),
        changedBytes: 0,
      }
      patchMetadata.set(entry.path, section)
      if (section.patch !== null) patches.set(entry.path, section.patch)
    }

    if (resolved.source.kind === "branch") {
      const untracked = (await this.git(rootPath, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean)
      for (const path of untracked) {
        const normalized = validateRelativePath(path)
        if (!names.some((entry) => entry.path === normalized)) {
          names.push({ path: normalized, previousPath: null, status: "untracked" })
        }
      }
    }

    const files: ReviewFileSummary[] = []
    for (const entry of names) {
      let patch = patches.get(entry.path) ?? ""
      let changedBytes = patchMetadata.get(entry.path)?.changedBytes ?? 0
      let revision = patchMetadata.get(entry.path)?.revision ?? sha256("")
      let stats: { additions: number | null; deletions: number | null; binary: boolean }
      if (entry.status === "untracked") {
        const untracked = await this.scanUntrackedFile(rootPath, entry.path)
        patch = untracked?.patch ?? ""
        if (untracked?.patch !== null && untracked?.patch !== undefined) {
          patches.set(entry.path, untracked.patch)
        }
        changedBytes = untracked?.changedBytes ?? 0
        revision = untracked?.revision ?? sha256("")
        stats = untracked?.binary
          ? { additions: null, deletions: null, binary: true }
          : { additions: untracked?.additions ?? 0, deletions: 0, binary: false }
      } else {
        stats = numstats.get(entry.path) ?? parseNumstat("")
      }
      const additions = stats.additions
      const deletions = stats.deletions
      files.push({
        ...entry,
        additions,
        deletions,
        changedLines: (additions ?? 0) + (deletions ?? 0),
        changedBytes,
        binary: stats.binary,
        revision,
      })
    }
    return { files, patches }
  }

  private cacheKey(projectId: string, source: ReviewSource) {
    return `${projectId}\0${reviewSourceKey(source)}`
  }

  private async repositoryFingerprint(rootPath: string, gitDirectory: string) {
    const [indexState, status] = await Promise.all([
      fileState(resolve(gitDirectory, "index")),
      this.git(rootPath, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]),
    ])
    const records = status.stdout.split("\0")
    const paths: string[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (!record || record.startsWith("# ")) continue
      if (record.startsWith("? ")) {
        paths.push(record.slice(2))
        continue
      }
      const ordinary = /^1 [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record)
      if (ordinary?.[1]) {
        paths.push(ordinary[1])
        continue
      }
      const renamed = /^2 [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record)
      if (renamed?.[1]) {
        paths.push(renamed[1])
        index += 1
        continue
      }
      const unmerged = /^u [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record)
      if (unmerged?.[1]) paths.push(unmerged[1])
    }
    const worktreeStates = await Promise.all(paths.map(async (path) => {
      const normalized = normalizedPath(path)
      const absolute = resolve(rootPath, normalized)
      const containment = relative(rootPath, absolute)
      return containment.startsWith("..") || isAbsolute(containment)
        ? `${normalized}\0denied`
        : `${normalized}\0${await this.worktreeState(rootPath, normalized)}`
    }))
    return sha256(`${indexState}\0${status.stdout}\0${worktreeStates.sort().join("\0")}`)
  }

  private async worktreeState(rootPath: string, path: string) {
    const absolute = resolve(rootPath, path)
    const containment = relative(rootPath, absolute)
    if (containment.startsWith("..") || isAbsolute(containment)) return "denied"
    const metadata = await lstat(absolute, { bigint: true }).catch(() => null)
    if (!metadata) return "missing"
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolute, "utf8").catch(() => "")
      return `symlink:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}:${target}`
    }
    const canonical = await realpath(absolute).catch(() => null)
    if (!canonical) return "missing"
    const canonicalContainment = relative(rootPath, canonical)
    if (canonicalContainment.startsWith("..") || isAbsolute(canonicalContainment)) return "denied"
    return `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`
  }

  private async buildSnapshotAttempt(
    projectId: string,
    source: ReviewSource,
    attempt: number,
  ): Promise<CachedReviewSnapshot> {
    const startedAt = performance.now()
    let phase: ReviewSnapshotPhase = "repository"
    try {
      const epoch = this.projectEpochs.get(projectId) ?? 0
      const { rootPath } = await this.repository(projectId)
      const gitDirectory = await this.assertStableRepositoryState(rootPath)
      phase = "source"
      const resolved = await this.resolveSource(projectId, rootPath, source)
      phase = "pre-scan"
      const beforeFingerprint = await this.repositoryFingerprint(rootPath, gitDirectory)
      phase = "diff-scan"
      const { files, patches } = await this.buildFileSummaries(rootPath, resolved)
      phase = "post-scan"
      await this.assertStableRepositoryState(rootPath, gitDirectory)
      const worktreeStates = new Map(
        await Promise.all(files.map(async (file) => [
          file.path,
          await this.worktreeState(rootPath, file.path),
        ] as const)),
      )
      const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0)
      const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0)
      const changedBytes = files.reduce((total, file) => total + file.changedBytes, 0)
      const changedLines = additions + deletions
      const indexState = await fileState(resolve(gitDirectory, "index"))
      const afterFingerprint = await this.repositoryFingerprint(rootPath, gitDirectory)
      phase = "finalize"
      let sourceChanged = false
      if (source.kind === "branch") {
        const currentHead = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
        const currentBase = currentHead
          ? await this.optionalGit(rootPath, ["merge-base", source.baseBranch, "HEAD"])
          : null
        sourceChanged = currentHead !== resolved.headSha || currentBase !== resolved.baseSha
      }
      const generation = sha256([
        reviewSourceKey(source),
        resolved.headSha ?? "",
        resolved.baseSha ?? "",
        ...files
          .map((file) => `${file.path}\0${file.status}\0${file.revision}`)
          .sort(),
      ].join("\0"))
      const snapshot: ReviewSummarySnapshot = {
        projectId,
        generation,
        source,
        repositoryRoot: rootPath,
        headSha: resolved.headSha,
        baseSha: resolved.baseSha,
        files,
        totals: { files: files.length, additions, deletions, changedLines, changedBytes },
        largeDiffMode: files.length > LARGE_FILE_COUNT || changedLines > LARGE_CHANGED_LINES || changedBytes > LARGE_CHANGED_BYTES,
      }
      if (snapshot.largeDiffMode) patches.clear()
      return {
        rootPath,
        gitDirectory,
        resolved,
        snapshot,
        patches,
        worktreeStates,
        indexState,
        fileDiffs: new Map(),
        fileDiffRequests: new Map(),
        stale: beforeFingerprint !== afterFingerprint
          || sourceChanged
          || (this.projectEpochs.get(projectId) ?? 0) !== epoch,
      }
    } catch (cause) {
      this.logger?.error("review.snapshot.build.failed", {
        details: {
          sourceKind: source.kind,
          attempt,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
          ...this.reviewFailureDetails(cause),
        },
      })
      throw cause
    }
  }

  private async buildSnapshot(projectId: string, source: ReviewSource): Promise<CachedReviewSnapshot> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const entry = await this.buildSnapshotAttempt(projectId, source, attempt)
      if (!entry.stale) return entry
      this.logger?.warn("review.snapshot.retry", {
        details: {
          sourceKind: source.kind,
          attempt,
          reason: "repository-changed",
          willRetry: attempt < 3,
        },
      })
    }
    throw new AgentError(
      "REVIEW_REPOSITORY_BUSY",
      "工作区持续变化，请稍后重试",
      503,
      { retryable: true },
    )
  }

  private refreshSnapshot(projectId: string, source: ReviewSource) {
    const key = this.cacheKey(projectId, source)
    const active = this.snapshotRequests.get(key)
    if (active) return active
    // Starting reconciliation acknowledges the previous dirty notification.
    // A filesystem change racing this refresh may therefore emit exactly one
    // trailing notification and the epoch check keeps the result stale.
    this.dirtyProjects.delete(projectId)
    const request = this.buildSnapshot(projectId, source).then((entry) => {
      this.snapshots.set(key, entry)
      return entry
    })
    this.snapshotRequests.set(key, request)
    void request.then(
      () => {
        if (this.snapshotRequests.get(key) === request) this.snapshotRequests.delete(key)
      },
      () => {
        if (this.snapshotRequests.get(key) === request) this.snapshotRequests.delete(key)
      },
    )
    return request
  }

  async summaryResult(
    projectId: string,
    source: ReviewSource,
    refresh = false,
  ): Promise<ReviewSummaryResult> {
    const startedAt = performance.now()
    const key = this.cacheKey(projectId, source)
    const cached = this.snapshots.get(key)
    const cacheHit = !refresh && cached !== undefined
    try {
      let result: ReviewSummaryResult
      if (!refresh && cached) {
        if (cached.stale) void this.refreshSnapshot(projectId, source).catch(() => undefined)
        result = {
          snapshot: cached.snapshot,
          cacheState: cached.stale ? "stale" : "fresh",
        }
      } else {
        const entry = await this.refreshSnapshot(projectId, source)
        result = {
          snapshot: entry.snapshot,
          cacheState: entry.stale ? "stale" : "fresh",
        }
      }
      this.logger?.info("review.summary.completed", {
        details: {
          sourceKind: source.kind,
          refresh,
          cacheHit,
          cacheState: result.cacheState,
          fileCount: result.snapshot.files.length,
          largeDiffMode: result.snapshot.largeDiffMode,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
      return result
    } catch (cause) {
      this.logger?.error("review.summary.failed", {
        details: {
          sourceKind: source.kind,
          refresh,
          durationMs: Math.round(performance.now() - startedAt),
          ...this.reviewFailureDetails(cause),
        },
      })
      throw cause
    }
  }

  async summary(projectId: string, source: ReviewSource): Promise<ReviewSummarySnapshot> {
    return (await this.summaryResult(projectId, source, true)).snapshot
  }

  private async snapshotForGeneration(
    projectId: string,
    source: ReviewSource,
    generation: string,
    paths?: string | readonly string[],
  ) {
    const key = this.cacheKey(projectId, source)
    let entry = this.snapshots.get(key)
    if (entry && !entry.stale) {
      const currentEntry = entry
      const indexChanged = source.kind === "unstaged"
        || source.kind === "staged"
        || source.kind === "branch"
        ? await fileState(resolve(currentEntry.gitDirectory, "index")) !== currentEntry.indexState
        : false
      const worktreePaths = paths === undefined
        ? []
        : typeof paths === "string"
          ? [paths]
          : paths
      const worktreeChanged = (source.kind === "unstaged" || source.kind === "branch")
        && (await Promise.all(worktreePaths.map(async (path) =>
          await this.worktreeState(currentEntry.rootPath, path) !== currentEntry.worktreeStates.get(path))))
          .some(Boolean)
      if (indexChanged || worktreeChanged) this.markProjectStale(projectId)
    }
    if (!entry || entry.stale) entry = await this.refreshSnapshot(projectId, source)
    if (entry.snapshot.generation !== generation) {
      throw new AgentError("REVIEW_SNAPSHOT_EXPIRED", "Review 快照已经过期，请刷新后重试", 409, {
        latestGeneration: entry.snapshot.generation,
        retryable: true,
      })
    }
    return entry
  }

  async fileDiff(input: { projectId: string; source: ReviewSource; generation: string; path: string; hideWhitespace?: boolean | undefined }): Promise<ReviewFileDiffResult> {
    const startedAt = performance.now()
    let path: string | undefined
    try {
      path = validateRelativePath(input.path)
      const entry = await this.snapshotForGeneration(input.projectId, input.source, input.generation, path)
      const requestKey = `${path}\0${input.hideWhitespace === true ? "whitespace-hidden" : "standard"}`
      const cached = entry.fileDiffs.get(requestKey)
      if (cached) return cached
      const active = entry.fileDiffRequests.get(requestKey)
      if (active) return active
      const request = (async () => {
        const file = entry.snapshot.files.find((candidate) => candidate.path === path)
        if (!file) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "文件不在当前 Review 来源中", 404)
        const patch = input.hideWhitespace === true
          ? await this.rawPatch(entry.rootPath, entry.resolved, path, true)
          : entry.patches.get(path) ?? await this.rawPatch(entry.rootPath, entry.resolved, path)
        const revision = file.revision
        const maximumLineBytes = patch.split("\n").reduce(
          (maximum, line) => Math.max(maximum, Buffer.byteLength(line, "utf8")),
          0,
        )
        const tooLargeReason = file.changedLines > UNRENDERABLE_CHANGED_LINES
          ? "changed-lines" as const
          : Buffer.byteLength(patch, "utf8") > UNRENDERABLE_CHANGED_BYTES
            ? "changed-bytes" as const
            : maximumLineBytes > UNRENDERABLE_LINE_BYTES
              ? "line-bytes" as const
              : null
        const result: ReviewFileDiffResult = {
          file: { ...file, revision },
          revision,
          patch,
          hunks: tooLargeReason || file.binary ? [] : parseHunks(patch),
          renderable: !tooLargeReason && !file.binary,
          tooLargeReason,
        }
        entry.fileDiffs.set(requestKey, result)
        return result
      })()
      entry.fileDiffRequests.set(requestKey, request)
      try {
        return await request
      } finally {
        if (entry.fileDiffRequests.get(requestKey) === request) {
          entry.fileDiffRequests.delete(requestKey)
        }
      }
    } catch (cause) {
      this.logger?.error("review.file-diff.failed", {
        details: {
          sourceKind: input.source.kind,
          path,
          hideWhitespace: input.hideWhitespace === true,
          durationMs: Math.round(performance.now() - startedAt),
          ...this.reviewFailureDetails(cause),
        },
      })
      throw cause
    }
  }

  async branches(projectId: string) {
    const { rootPath } = await this.repository(projectId)
    const current = await this.optionalGit(rootPath, ["branch", "--show-current"])
    const output = await this.git(rootPath, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(HEAD)", "refs/heads", "refs/remotes"])
    const branches = output.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      const [refname, sha, marker] = line.split("\0")
      if (!refname || !sha || refname.endsWith("/HEAD")) return []
      const remote = refname.startsWith("refs/remotes/")
      return [{
        name: refname.replace(remote ? /^refs\/remotes\// : /^refs\/heads\//, ""),
        sha,
        current: marker === "*",
        remote,
      }]
    })
    return { current, branches }
  }

  async commits(projectId: string, limit = 50) {
    const { rootPath } = await this.repository(projectId)
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const output = await this.git(rootPath, ["log", `-${safeLimit}`, "--format=%H%x00%h%x00%s%x00%an%x00%at"], undefined, [0, 128])
    if (output.code !== 0) return { commits: [] }
    return {
      commits: output.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        const [sha, shortSha, subject, author, authoredAt] = line.split("\0")
        if (!sha || !shortSha || subject === undefined || author === undefined || authoredAt === undefined) return []
        return [{ sha, shortSha, subject, author, authoredAt: Number.parseInt(authoredAt, 10) * 1_000 }]
      }),
    }
  }

  async status(projectId: string) {
    const { rootPath } = await this.repository(projectId)
    const branchName = await this.optionalGit(rootPath, ["branch", "--show-current"])
    const upstream = await this.optionalGit(
      rootPath,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    )
    let ahead = 0
    let behind = 0
    if (upstream) {
      const counts = await this.optionalGit(
        rootPath,
        ["rev-list", "--left-right", "--count", `HEAD...${upstream}`],
      )
      if (counts) {
        const [rawAhead, rawBehind] = counts.split(/\s+/)
        ahead = Number.parseInt(rawAhead ?? "0", 10) || 0
        behind = Number.parseInt(rawBehind ?? "0", 10) || 0
      }
    }
    const porcelain = await this.git(
      rootPath,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    const files = parsePorcelainStatus(porcelain.stdout)
    return {
      branchName,
      upstream,
      ahead,
      behind,
      clean: files.length === 0,
      files,
    }
  }

  async commit(input: {
    projectId: string
    message: string
    paths: readonly string[]
  }) {
    const message = input.message.trim()
    if (!message) {
      throw new AgentError("INVALID_REQUEST", "提交信息不能为空", 400)
    }
    const { rootPath } = await this.repository(input.projectId)
    const paths = [...new Set(input.paths.map(validateRelativePath))]
    if (paths.length > 0) {
      await this.gitPaths(rootPath, ["add", "-A"], paths)
    }
    const staged = await this.git(
      rootPath,
      ["diff", "--cached", "--quiet", "--exit-code"],
      undefined,
      [0, 1],
    )
    if (staged.code === 0) {
      throw new AgentError("CONFLICT", "没有可提交的已暂存变更", 409)
    }
    const committed = await this.git(rootPath, ["commit", "-m", message])
    const headSha = await this.optionalGit(rootPath, ["rev-parse", "HEAD"])
    if (!headSha) {
      throw new AgentError("GIT_COMMAND_FAILED", "提交完成后无法读取 HEAD", 500)
    }
    return {
      ok: true as const,
      headSha,
      output: committed.stdout.trim(),
      status: await this.status(input.projectId),
    }
  }

  async apply(input: {
    projectId: string
    source: ReviewSource
    generation: string
    expectedRevision: string
    action: "stage" | "unstage" | "revert"
    target: { kind: "file"; path: string } | { kind: "hunk"; path: string; hunkId: string }
  }): Promise<ReviewApplyResult> {
    if (input.source.kind !== "unstaged" && input.source.kind !== "staged") {
      throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "当前来源是只读的", 409)
    }
    const path = validateRelativePath(input.target.path)
    const current = await this.fileDiff({
      projectId: input.projectId,
      source: input.source,
      generation: input.generation,
      path,
    })
    if (current.revision !== input.expectedRevision) {
      throw new AgentError("REVIEW_SNAPSHOT_EXPIRED", "文件内容已经变化，请刷新后重试", 409)
    }
    const { rootPath } = await this.repository(input.projectId)
    const targetHunkId = input.target.kind === "hunk" ? input.target.hunkId : null
    const patch = targetHunkId
      ? current.hunks.find((hunk) => hunk.id === targetHunkId)?.patch
      : current.patch
    if (input.target.kind === "hunk" && !patch) throw new AgentError("REVIEW_SNAPSHOT_EXPIRED", "目标 Hunk 已不存在", 409)

    if (input.action === "stage") {
      if (input.source.kind !== "unstaged") throw new AgentError("CONFLICT", "只能暂存未暂存的变更", 409)
      if (input.target.kind === "file") await this.gitPaths(rootPath, ["add"], [path])
      else await this.git(rootPath, ["apply", "--cached", "--binary", "-"], patch)
    } else if (input.action === "unstage") {
      if (input.source.kind !== "staged") throw new AgentError("CONFLICT", "只能取消暂存已暂存的变更", 409)
      if (input.target.kind === "file") {
        const head = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
        if (head) await this.gitPaths(rootPath, ["restore", "--staged"], [path])
        else await this.gitPaths(rootPath, ["rm", "--cached"], [path])
      } else {
        await this.git(rootPath, ["apply", "--cached", "--reverse", "--binary", "-"], patch)
      }
    } else if (input.source.kind === "unstaged") {
      if (input.target.kind === "file" && current.file.status === "untracked") {
        const absolute = resolve(rootPath, path)
        const containment = relative(rootPath, absolute)
        if (containment.startsWith("..") || isAbsolute(containment)) throw new AgentError("PATH_DENIED", "文件超出仓库边界", 403)
        await unlink(absolute)
      } else if (input.target.kind === "file") {
        await this.gitPaths(rootPath, ["restore", "--worktree"], [path])
      } else {
        await this.git(rootPath, ["apply", "--reverse", "--binary", "-"], patch)
      }
    } else if (input.target.kind === "file") {
      const head = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
      if (!head) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "空仓库无法恢复已暂存内容", 409)
      await this.gitPaths(rootPath, ["restore", "--source=HEAD", "--staged", "--worktree"], [path])
    } else {
      await this.git(rootPath, ["apply", "--cached", "--reverse", "--binary", "-"], patch)
      await this.git(rootPath, ["apply", "--reverse", "--binary", "-"], patch)
    }

    this.markProjectStale(input.projectId)
    const refreshed = await this.refreshSnapshot(input.projectId, input.source)
    return {
      ok: true,
      action: input.action,
      path,
      generation: refreshed.snapshot.generation,
    }
  }

  async applyBatch(input: {
    projectId: string
    source: ReviewSource
    generation: string
    action: "stage" | "unstage" | "revert"
    items: readonly { path: string; expectedRevision: string }[]
  }): Promise<ReviewApplyBatchResult> {
    if (input.source.kind !== "unstaged" && input.source.kind !== "staged") {
      throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "当前来源是只读的", 409)
    }
    if (input.items.length === 0) {
      throw new AgentError("INVALID_REQUEST", "批量 Review 操作至少需要一个文件", 400)
    }
    if (input.action === "stage" && input.source.kind !== "unstaged") {
      throw new AgentError("CONFLICT", "只能暂存未暂存的变更", 409)
    }
    if (input.action === "unstage" && input.source.kind !== "staged") {
      throw new AgentError("CONFLICT", "只能取消暂存已暂存的变更", 409)
    }

    const items = input.items.map((item) => ({
      path: validateRelativePath(item.path),
      expectedRevision: item.expectedRevision,
    }))
    if (new Set(items.map((item) => item.path)).size !== items.length) {
      throw new AgentError("INVALID_REQUEST", "批量 Review 操作包含重复文件", 400)
    }

    const entry = await this.snapshotForGeneration(
      input.projectId,
      input.source,
      input.generation,
      items.map((item) => item.path),
    )
    const filesByPath = new Map(entry.snapshot.files.map((file) => [file.path, file]))
    for (const item of items) {
      const file = filesByPath.get(item.path)
      if (!file || file.revision !== item.expectedRevision) {
        throw new AgentError("REVIEW_SNAPSHOT_EXPIRED", "文件内容已经变化，请刷新后重试", 409)
      }
    }

    const paths = items.map((item) => item.path)
    let appliedCount = 0
    if (input.action === "stage") {
      await this.gitPaths(entry.rootPath, ["add"], paths)
      appliedCount = paths.length
    } else if (input.action === "unstage") {
      const head = await this.optionalGit(entry.rootPath, ["rev-parse", "--verify", "HEAD"])
      if (head) await this.gitPaths(entry.rootPath, ["restore", "--staged"], paths)
      else await this.gitPaths(entry.rootPath, ["rm", "--cached"], paths)
      appliedCount = paths.length
    } else if (input.source.kind === "unstaged") {
      const untrackedPaths = paths.filter((path) => filesByPath.get(path)?.status === "untracked")
      const untrackedAbsolutePaths = new Map<string, string>()
      for (const path of untrackedPaths) {
        const absolute = resolve(entry.rootPath, path)
        const containment = relative(entry.rootPath, absolute)
        if (containment.startsWith("..") || isAbsolute(containment)) {
          throw new AgentError("PATH_DENIED", "文件超出仓库边界", 403)
        }
        if (!await lstat(absolute).catch(() => null)) {
          throw new AgentError("REVIEW_SNAPSHOT_EXPIRED", "文件内容已经变化，请刷新后重试", 409)
        }
        untrackedAbsolutePaths.set(path, absolute)
      }
      try {
        for (const path of paths) {
          const absolute = untrackedAbsolutePaths.get(path)
          if (absolute) await unlink(absolute)
          else await this.gitPaths(entry.rootPath, ["restore", "--worktree"], [path])
          appliedCount += 1
        }
      } catch (cause) {
        this.markProjectStale(input.projectId)
        if (appliedCount > 0) {
          throw new AgentError(
            "REVIEW_BATCH_PARTIAL",
            "部分文件已处理，请刷新后确认工作区状态",
            409,
            { appliedCount, totalCount: paths.length },
          )
        }
        throw cause
      }
    } else {
      const head = await this.optionalGit(entry.rootPath, ["rev-parse", "--verify", "HEAD"])
      if (!head) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "空仓库无法恢复已暂存内容", 409)
      try {
        for (const path of paths) {
          await this.gitPaths(entry.rootPath, ["restore", "--source=HEAD", "--staged", "--worktree"], [path])
          appliedCount += 1
        }
      } catch (cause) {
        this.markProjectStale(input.projectId)
        if (appliedCount > 0) {
          throw new AgentError(
            "REVIEW_BATCH_PARTIAL",
            "部分文件已处理，请刷新后确认工作区状态",
            409,
            { appliedCount, totalCount: paths.length },
          )
        }
        throw cause
      }
    }

    this.markProjectStale(input.projectId)
    const refreshed = await this.refreshSnapshot(input.projectId, input.source)
    return {
      ok: true,
      action: input.action,
      paths,
      generation: refreshed.snapshot.generation,
      appliedCount,
    }
  }

  listComments(input: { threadId: string; projectId: string; sourceKey: string }) {
    return this.db.listReviewComments(input)
  }

  saveComment(input: {
    id?: string | undefined
    threadId: string
    projectId: string
    sourceKey: string
    path: string
    side: "old" | "new"
    line: number
    hunkId: string | null
    revision: string
    body: string
    githubCommentId?: string | undefined
    githubThreadId?: string | undefined
  }): ReviewComment {
    validateRelativePath(input.path)
    return this.db.saveReviewComment({ ...input, path: normalizedPath(input.path) })
  }

  resolveComment(input: { id: string; threadId: string; projectId: string }) {
    return this.db.resolveReviewComment(input)
  }

  deleteComment(input: { id: string; threadId: string; projectId: string }) {
    this.db.deleteReviewComment(input)
    return { ok: true as const }
  }
}
