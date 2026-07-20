import { createHash } from "node:crypto"
import { watch as watchFileSystem, type FSWatcher } from "node:fs"
import { mkdtemp, realpath, rm, stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import type {
  ReviewApplyResult,
  ReviewComment,
  ReviewFileDiffResult,
  ReviewFileSummary,
  ReviewSource,
  ReviewSummarySnapshot,
} from "@codepilotx/agent-protocol"
import { AgentError } from "../domain"
import type { AgentDatabase } from "../storage/Database"

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

type GitResult = { code: number; stdout: string; stderr: string }
type ResolvedSource = {
  source: ReviewSource
  args: string[]
  headSha: string | null
  baseSha: string | null
}
type NameStatus = {
  path: string
  previousPath: string | null
  status: ReviewFileSummary["status"]
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")
const sourceKey = (source: ReviewSource) => JSON.stringify(source)
const normalizedPath = (path: string) => path.replaceAll("\\", "/")

const decode = (bytes: ArrayBuffer, stream: "stdout" | "stderr") => {
  if (bytes.byteLength > MAX_GIT_OUTPUT_BYTES) {
    throw new AgentError("REVIEW_OUTPUT_TOO_LARGE", `Git ${stream} 超过 ${MAX_GIT_OUTPUT_BYTES} 字节限制`, 413)
  }
  try {
    return decoder.decode(bytes)
  } catch {
    throw new AgentError("REVIEW_INVALID_UTF8", `Git ${stream} 包含非法 UTF-8`, 400)
  }
}

const validateRelativePath = (path: string) => {
  const normalized = normalizedPath(path)
  if (!normalized || isAbsolute(path) || normalized.split("/").includes("..") || normalized.includes("\0")) {
    throw new AgentError("PATH_DENIED", "Review 文件路径必须是仓库内相对路径", 403)
  }
  return normalized
}

const mapStatus = (status: string): ReviewFileSummary["status"] => {
  switch (status[0]) {
    case "A": return "added"
    case "M": return "modified"
    case "D": return "deleted"
    case "R": return "renamed"
    case "C": return "copied"
    case "T": return "type-changed"
    case "?": return "untracked"
    default: return "unknown"
  }
}

const parseNameStatus = (value: string): NameStatus[] => {
  const fields = value.split("\0")
  const result: NameStatus[] = []
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++]
    if (!rawStatus) continue
    const firstPath = fields[index++]
    if (!firstPath) continue
    if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
      const destination = fields[index++]
      if (!destination) continue
      result.push({
        path: validateRelativePath(destination),
        previousPath: validateRelativePath(firstPath),
        status: mapStatus(rawStatus),
      })
    } else {
      result.push({
        path: validateRelativePath(firstPath),
        previousPath: null,
        status: mapStatus(rawStatus),
      })
    }
  }
  return result
}

const parsePorcelainStatus = (value: string) => {
  const fields = value.split("\0")
  const files: Array<{
    path: string
    previousPath: string | null
    stagedStatus: string
    unstagedStatus: string
    untracked: boolean
  }> = []
  for (let index = 0; index < fields.length;) {
    const field = fields[index++]
    if (!field || field.length < 4) continue
    const stagedStatus = field[0] ?? " "
    const unstagedStatus = field[1] ?? " "
    const path = validateRelativePath(field.slice(3))
    const renamedOrCopied =
      stagedStatus === "R" ||
      stagedStatus === "C" ||
      unstagedStatus === "R" ||
      unstagedStatus === "C"
    const previousPath = renamedOrCopied
      ? validateRelativePath(fields[index++] ?? "")
      : null
    files.push({
      path,
      previousPath,
      stagedStatus,
      unstagedStatus,
      untracked: stagedStatus === "?" && unstagedStatus === "?",
    })
  }
  return files
}

const parseNumstat = (value: string) => {
  const first = value.split("\0").find(Boolean)
  if (!first) return { additions: 0, deletions: 0, binary: false }
  const [added = "0", deleted = "0"] = first.split("\t")
  if (added === "-" || deleted === "-") return { additions: null, deletions: null, binary: true }
  return {
    additions: Number.parseInt(added, 10) || 0,
    deletions: Number.parseInt(deleted, 10) || 0,
    binary: false,
  }
}

const parseHunks = (patch: string) => {
  const matches = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)]
  if (!matches.length) return []
  const preamble = patch.slice(0, matches[0]!.index)
  return matches.map((match, index) => {
    const start = match.index!
    const end = matches[index + 1]?.index ?? patch.length
    const body = patch.slice(start, end)
    const hunkPatch = `${preamble}${body}`
    return {
      id: sha256(hunkPatch),
      header: match[0],
      oldStart: Number.parseInt(match[1]!, 10),
      oldLines: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
      newStart: Number.parseInt(match[3]!, 10),
      newLines: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
      patch: hunkPatch,
    }
  })
}

export class GitReviewService {
  private readonly watchers = new Map<string, FSWatcher>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly onChanged?: ((projectId: string) => void | Promise<void>) | undefined,
    private readonly resolvePullRequest?: ((input: {
      workspaceRoot: string
      owner: string
      repository: string
      number: number
    }) => Promise<{ baseSha: string; headSha: string }>) | undefined,
  ) {}

  private async git(
    cwd: string,
    args: readonly string[],
    input?: string,
    acceptedCodes: readonly number[] = [0],
    env?: Readonly<Record<string, string>>,
  ): Promise<GitResult> {
    const child = Bun.spawn(["git", "-c", "core.quotepath=false", "-c", "core.fsmonitor=false", ...args], {
      cwd,
      ...(env ? { env: { ...process.env, ...env } } : {}),
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    })
    const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS)
    try {
      const [stdoutBytes, stderrBytes, code] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
        child.exited,
      ])
      const result = {
        code,
        stdout: decode(stdoutBytes, "stdout"),
        stderr: decode(stderrBytes, "stderr"),
      }
      if (!acceptedCodes.includes(code)) {
        throw new AgentError("GIT_COMMAND_FAILED", "Git 操作失败", 409, {
          args: args.slice(0, 3),
          stderr: result.stderr.slice(0, 4_000),
        })
      }
      return result
    } finally {
      clearTimeout(timer)
    }
  }

  private async repository(projectId: string) {
    const project = this.db.getProject(projectId)
    if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
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
    this.ensureWatcher(projectId, rootPath)
    return { project, rootPath }
  }

  private ensureWatcher(projectId: string, rootPath: string) {
    if (!this.onChanged || this.watchers.has(projectId)) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    try {
      const watcher = watchFileSystem(rootPath, { persistent: false, recursive: true }, () => {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          debounce = undefined
          void Promise.resolve(this.onChanged?.(projectId)).catch(() => undefined)
        }, 100)
      })
      watcher.on("error", () => {
        if (debounce) clearTimeout(debounce)
        this.watchers.delete(projectId)
        watcher.close()
      })
      this.watchers.set(projectId, watcher)
    } catch {
      // Review remains usable through explicit refresh on platforms that do
      // not provide recursive filesystem watching.
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

  private async optionalGit(cwd: string, args: readonly string[]) {
    const result = await this.git(cwd, args, undefined, [0, 1, 128])
    return result.code === 0 ? result.stdout.trim() || null : null
  }

  private async resolveSource(rootPath: string, source: ReviewSource): Promise<ResolvedSource> {
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

  private async generation(rootPath: string, source: ReviewSource, stableAlready = false) {
    if (!stableAlready) await this.assertStableRepositoryState(rootPath)
    // Keep index-reading commands sequential. Git may refresh index stat data
    // during a read; running these commands concurrently can manufacture a
    // generation change even though repository content did not change.
    const head = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
    const index = await this.optionalGit(rootPath, ["write-tree"])
    const status = await this.git(rootPath, ["status", "--porcelain=v2", "-z", "--untracked-files=all"])
    const changedPaths = await this.git(rootPath, ["ls-files", "-m", "-d", "-o", "--exclude-standard", "-z"])
    const worktreeRevisions: string[] = []
    for (const rawPath of changedPaths.stdout.split("\0").filter(Boolean).sort()) {
      const path = validateRelativePath(rawPath)
      const revision = await this.optionalGit(rootPath, ["hash-object", "--", path])
      worktreeRevisions.push(`${path}\0${revision ?? "deleted"}`)
    }
    return sha256(`${sourceKey(source)}\0${head ?? ""}\0${index ?? ""}\0${status.stdout}\0${worktreeRevisions.join("\0")}`)
  }

  private async rawPatch(rootPath: string, resolved: ResolvedSource, path: string, hideWhitespace = false) {
    const common = ["diff", "--binary", "--no-ext-diff", "--no-color", "--full-index", ...(hideWhitespace ? ["-w"] : [])]
    const tracked = await this.git(
      rootPath,
      [...common, ...resolved.args, "--", path],
      undefined,
      [0, 1],
    )
    if (tracked.stdout) return tracked.stdout
    if (resolved.source.kind === "unstaged" || resolved.source.kind === "branch") {
      const untrackedPath = await this.optionalGit(
        rootPath,
        ["ls-files", "--others", "--exclude-standard", "--", path],
      )
      if (!untrackedPath) return ""
      const absolute = resolve(rootPath, path)
      const containment = relative(rootPath, absolute)
      if (containment.startsWith("..") || isAbsolute(containment)) throw new AgentError("PATH_DENIED", "文件超出仓库边界", 403)
      const metadata = await stat(absolute).catch(() => null)
      if (!metadata?.isFile()) return ""
      const untracked = await this.git(rootPath, [...common, "--no-index", "--", "/dev/null", absolute], undefined, [0, 1])
      return untracked.stdout
        .replaceAll(absolute.replaceAll("\\", "/"), `b/${path}`)
        .replace(/^diff --git "?.*"? "?.*"?$/m, `diff --git a/${path} b/${path}`)
    }
    return ""
  }

  private async fileSummaries(rootPath: string, resolved: ResolvedSource) {
    const names = parseNameStatus((await this.git(rootPath, ["diff", "--name-status", "-z", "--find-renames", ...resolved.args])).stdout)
    if (resolved.source.kind === "unstaged" || resolved.source.kind === "branch") {
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
      const patch = await this.rawPatch(rootPath, resolved, entry.path)
      let stats: { additions: number | null; deletions: number | null; binary: boolean }
      if (entry.status === "untracked") {
        const additions = patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length
        stats = { additions, deletions: 0, binary: patch.includes("GIT binary patch") || patch.includes("Binary files") }
        if (stats.binary) stats = { additions: null, deletions: null, binary: true }
      } else {
        stats = parseNumstat((await this.git(rootPath, ["diff", "--numstat", "-z", ...resolved.args, "--", entry.path])).stdout)
      }
      const additions = stats.additions
      const deletions = stats.deletions
      files.push({
        ...entry,
        additions,
        deletions,
        changedLines: (additions ?? 0) + (deletions ?? 0),
        changedBytes: Buffer.byteLength(patch, "utf8"),
        binary: stats.binary,
        revision: sha256(patch),
      })
    }
    return files
  }

  async summary(projectId: string, source: ReviewSource): Promise<ReviewSummarySnapshot> {
    const { rootPath } = await this.repository(projectId)
    const gitDirectory = await this.assertStableRepositoryState(rootPath)
    const resolved = await this.resolveSource(rootPath, source)
    const files = await this.fileSummaries(rootPath, resolved)
    await this.assertStableRepositoryState(rootPath, gitDirectory)
    const generation = await this.generation(rootPath, source, true)
    const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0)
    const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0)
    const changedBytes = files.reduce((total, file) => total + file.changedBytes, 0)
    const changedLines = additions + deletions
    return {
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
  }

  async fileDiff(input: { projectId: string; source: ReviewSource; generation: string; path: string; hideWhitespace?: boolean | undefined }): Promise<ReviewFileDiffResult> {
    const path = validateRelativePath(input.path)
    const snapshot = await this.summary(input.projectId, input.source)
    if (snapshot.generation !== input.generation) {
      throw new AgentError("REVIEW_SNAPSHOT_EXPIRED", "Review 快照已经过期，请刷新后重试", 409, {
        expected: input.generation,
        actual: snapshot.generation,
      })
    }
    const file = snapshot.files.find((candidate) => candidate.path === path)
    if (!file) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "文件不在当前 Review 来源中", 404)
    const { rootPath } = await this.repository(input.projectId)
    const resolved = await this.resolveSource(rootPath, input.source)
    const patch = await this.rawPatch(rootPath, resolved, path, input.hideWhitespace)
    const revision = sha256(patch)
    const maximumLineBytes = patch.split("\n").reduce((maximum, line) => Math.max(maximum, Buffer.byteLength(line, "utf8")), 0)
    const tooLargeReason = file.changedLines > UNRENDERABLE_CHANGED_LINES
      ? "changed-lines" as const
      : Buffer.byteLength(patch, "utf8") > UNRENDERABLE_CHANGED_BYTES
        ? "changed-bytes" as const
        : maximumLineBytes > UNRENDERABLE_LINE_BYTES
          ? "line-bytes" as const
          : null
    return {
      file: { ...file, revision },
      revision,
      patch,
      hunks: tooLargeReason || file.binary ? [] : parseHunks(patch),
      renderable: !tooLargeReason && !file.binary,
      tooLargeReason,
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
      await this.git(rootPath, ["add", "-A", "--", ...paths])
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
      if (input.target.kind === "file") await this.git(rootPath, ["add", "--", path])
      else await this.git(rootPath, ["apply", "--cached", "--binary", "-"], patch)
    } else if (input.action === "unstage") {
      if (input.source.kind !== "staged") throw new AgentError("CONFLICT", "只能取消暂存已暂存的变更", 409)
      if (input.target.kind === "file") {
        const head = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
        if (head) await this.git(rootPath, ["restore", "--staged", "--", path])
        else await this.git(rootPath, ["rm", "--cached", "--", path])
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
        await this.git(rootPath, ["restore", "--worktree", "--", path])
      } else {
        await this.git(rootPath, ["apply", "--reverse", "--binary", "-"], patch)
      }
    } else if (input.target.kind === "file") {
      const head = await this.optionalGit(rootPath, ["rev-parse", "--verify", "HEAD"])
      if (!head) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "空仓库无法恢复已暂存内容", 409)
      await this.git(rootPath, ["restore", "--source=HEAD", "--staged", "--worktree", "--", path])
    } else {
      await this.git(rootPath, ["apply", "--cached", "--reverse", "--binary", "-"], patch)
      await this.git(rootPath, ["apply", "--reverse", "--binary", "-"], patch)
    }

    return {
      ok: true,
      action: input.action,
      path,
      generation: await this.generation(rootPath, input.source),
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
