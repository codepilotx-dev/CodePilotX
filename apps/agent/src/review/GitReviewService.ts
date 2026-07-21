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
  ReviewSummaryResult,
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

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")
const sourceKey = (source: ReviewSource) => JSON.stringify(source)
const normalizedPath = (path: string) => path.replaceAll("\\", "/")
const fileState = async (path: string) => {
  const metadata = await stat(path, { bigint: true }).catch(() => null)
  if (!metadata) return "missing"
  return `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`
}

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

const parseNumstats = (value: string) => {
  const result = new Map<string, {
    additions: number | null
    deletions: number | null
    binary: boolean
  }>()
  const fields = value.split("\0")
  for (let index = 0; index < fields.length;) {
    const field = fields[index++]
    if (!field) continue
    const [added = "0", deleted = "0", inlinePath = ""] = field.split("\t")
    let path = inlinePath
    if (!path) {
      index += 1
      path = fields[index++] ?? ""
    }
    if (!path) continue
    const normalized = validateRelativePath(path)
    result.set(
      normalized,
      added === "-" || deleted === "-"
        ? { additions: null, deletions: null, binary: true }
        : {
            additions: Number.parseInt(added, 10) || 0,
            deletions: Number.parseInt(deleted, 10) || 0,
            binary: false,
          },
    )
  }
  return result
}

const textFilePatch = (path: string, content: string) => {
  const normalized = content.replaceAll("\r\n", "\n")
  const hasFinalNewline = normalized.endsWith("\n")
  const body = hasFinalNewline ? normalized.slice(0, -1) : normalized
  const lines = body ? body.split("\n") : []
  const additions = lines.length
  const patchLines = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${additions} @@`,
    ...lines.map((line) => `+${line}`),
  ]
  if (!hasFinalNewline && lines.length > 0) patchLines.push("\\ No newline at end of file")
  return {
    patch: `${patchLines.join("\n")}\n`,
    additions,
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
  private readonly snapshots = new Map<string, CachedReviewSnapshot>()
  private readonly snapshotRequests = new Map<string, Promise<CachedReviewSnapshot>>()
  private readonly projectEpochs = new Map<string, number>()
  private readonly repositoryRoots = new Map<string, string>()
  private readonly dirtyProjects = new Set<string>()

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
  ) {}

  dispose() {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private async git(
    cwd: string,
    args: readonly string[],
    input?: string,
    acceptedCodes: readonly number[] = [0],
    env?: Readonly<Record<string, string>>,
  ): Promise<GitResult> {
    this.onGitCommand?.(args)
    const child = Bun.spawn(["git", "-c", "core.quotepath=false", "-c", "core.fsmonitor=false", ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        ...env,
      },
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

  private async scanPatch(cwd: string, args: readonly string[]): Promise<PatchScanSection[]> {
    this.onGitCommand?.(args)
    const child = Bun.spawn(
      ["git", "-c", "core.quotepath=false", "-c", "core.fsmonitor=false", ...args],
      {
        cwd,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS)
    const sections: PatchScanSection[] = []
    const streamDecoder = new TextDecoder("utf-8", { fatal: true })
    let pending = ""
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

    const consumeStdout = (async () => {
      const reader = child.stdout.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          pending += streamDecoder.decode(value, { stream: true })
          let lineEnd = pending.indexOf("\n")
          while (lineEnd >= 0) {
            consume(pending.slice(0, lineEnd + 1))
            pending = pending.slice(lineEnd + 1)
            lineEnd = pending.indexOf("\n")
          }
        }
        pending += streamDecoder.decode()
        if (pending) consume(pending)
        finalize()
      } catch (cause) {
        child.kill()
        if (cause instanceof TypeError) {
          throw new AgentError("REVIEW_INVALID_UTF8", "Git stdout 包含非法 UTF-8", 400)
        }
        throw cause
      } finally {
        reader.releaseLock()
      }
    })()

    try {
      const [_, stderrBytes, code] = await Promise.all([
        consumeStdout,
        new Response(child.stderr).arrayBuffer(),
        child.exited,
      ])
      const stderr = decode(stderrBytes, "stderr")
      if (code !== 0 && code !== 1) {
        throw new AgentError("GIT_COMMAND_FAILED", "Git 操作失败", 409, {
          args: args.slice(0, 3),
          stderr: stderr.slice(0, 4_000),
        })
      }
      return sections
    } finally {
      clearTimeout(timer)
    }
  }

  private async repository(projectId: string) {
    const project = this.db.getProject(projectId)
    if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
    const cachedRoot = this.repositoryRoots.get(projectId)
    if (cachedRoot) {
      this.ensureWatcher(projectId, cachedRoot)
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
    this.ensureWatcher(projectId, rootPath)
    return { project, rootPath }
  }

  private ensureWatcher(projectId: string, rootPath: string) {
    if (!this.onChanged || this.watchers.has(projectId)) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    let maxWait: ReturnType<typeof setTimeout> | undefined
    let unknownPath = false
    const pendingPaths = new Set<string>()
    const flush = async () => {
      if (debounce) clearTimeout(debounce)
      if (maxWait) clearTimeout(maxWait)
      debounce = undefined
      maxWait = undefined
      const paths = [...pendingPaths]
      pendingPaths.clear()
      const invalidate = unknownPath || await this.shouldInvalidateWatchPaths(rootPath, paths)
      unknownPath = false
      if (!invalidate) return
      this.markProjectStale(projectId)
      if (this.dirtyProjects.has(projectId)) return
      this.dirtyProjects.add(projectId)
      await Promise.resolve(this.onChanged?.(projectId)).catch(() => undefined)
    }
    try {
      const watcher = watchFileSystem(rootPath, { persistent: false, recursive: true }, (_event, filename) => {
        if (filename == null) unknownPath = true
        else pendingPaths.add(normalizedPath(filename.toString()))
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          void flush()
        }, 250)
        maxWait ??= setTimeout(() => {
          void flush()
        }, 1_000)
      })
      watcher.on("error", () => {
        if (debounce) clearTimeout(debounce)
        if (maxWait) clearTimeout(maxWait)
        this.watchers.delete(projectId)
        watcher.close()
      })
      this.watchers.set(projectId, watcher)
    } catch {
      // Review remains usable through explicit refresh on platforms that do
      // not provide recursive filesystem watching.
    }
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

  private async rawPatch(rootPath: string, resolved: ResolvedSource, path: string, hideWhitespace = false) {
    const common = ["diff", "--binary", "--no-ext-diff", "--no-color", "--full-index", ...(hideWhitespace ? ["-w"] : [])]
    const tracked = await this.git(
      rootPath,
      [...common, ...resolved.args, "--", path],
      undefined,
      [0, 1],
    )
    if (tracked.stdout) return tracked.stdout
    if (resolved.source.kind === "branch") {
      return (await this.untrackedFile(rootPath, path))?.patch ?? ""
    }
    return ""
  }

  private async untrackedFile(rootPath: string, path: string) {
    const absolute = resolve(rootPath, path)
    const containment = relative(rootPath, absolute)
    if (containment.startsWith("..") || isAbsolute(containment)) {
      throw new AgentError("PATH_DENIED", "文件超出仓库边界", 403)
    }
    const file = Bun.file(absolute)
    if (!await file.exists()) return null
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
    const absolute = resolve(rootPath, path)
    const containment = relative(rootPath, absolute)
    if (containment.startsWith("..") || isAbsolute(containment)) {
      throw new AgentError("PATH_DENIED", "文件超出仓库边界", 403)
    }
    const file = Bun.file(absolute)
    if (!await file.exists()) return null
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
    return `${projectId}\0${sourceKey(source)}`
  }

  private async buildSnapshot(projectId: string, source: ReviewSource): Promise<CachedReviewSnapshot> {
    const epoch = this.projectEpochs.get(projectId) ?? 0
    const { rootPath } = await this.repository(projectId)
    const gitDirectory = await this.assertStableRepositoryState(rootPath)
    const resolved = await this.resolveSource(rootPath, source)
    const { files, patches } = await this.buildFileSummaries(rootPath, resolved)
    await this.assertStableRepositoryState(rootPath, gitDirectory)
    const worktreeStates = new Map(
      await Promise.all(files.map(async (file) => [
        file.path,
        await fileState(resolve(rootPath, file.path)),
      ] as const)),
    )
    const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0)
    const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0)
    const changedBytes = files.reduce((total, file) => total + file.changedBytes, 0)
    const changedLines = additions + deletions
    const generation = sha256([
      sourceKey(source),
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
      indexState: await fileState(resolve(gitDirectory, "index")),
      fileDiffs: new Map(),
      fileDiffRequests: new Map(),
      stale: (this.projectEpochs.get(projectId) ?? 0) !== epoch,
    }
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
    const key = this.cacheKey(projectId, source)
    const cached = this.snapshots.get(key)
    if (!refresh && cached) {
      if (cached.stale) void this.refreshSnapshot(projectId, source).catch(() => undefined)
      return {
        snapshot: cached.snapshot,
        cacheState: cached.stale ? "stale" : "fresh",
      }
    }
    const entry = await this.refreshSnapshot(projectId, source)
    return {
      snapshot: entry.snapshot,
      cacheState: entry.stale ? "stale" : "fresh",
    }
  }

  async summary(projectId: string, source: ReviewSource): Promise<ReviewSummarySnapshot> {
    return (await this.summaryResult(projectId, source, true)).snapshot
  }

  private async snapshotForGeneration(
    projectId: string,
    source: ReviewSource,
    generation: string,
    path?: string,
  ) {
    const key = this.cacheKey(projectId, source)
    let entry = this.snapshots.get(key)
    if (entry && !entry.stale) {
      const indexChanged = source.kind === "unstaged"
        || source.kind === "staged"
        || source.kind === "branch"
        ? await fileState(resolve(entry.gitDirectory, "index")) !== entry.indexState
        : false
      const worktreeChanged = path !== undefined
        && (source.kind === "unstaged" || source.kind === "branch")
        ? await fileState(resolve(entry.rootPath, path)) !== entry.worktreeStates.get(path)
        : false
      if (indexChanged || worktreeChanged) this.markProjectStale(projectId)
    }
    if (!entry || entry.stale) entry = await this.refreshSnapshot(projectId, source)
    if (entry.snapshot.generation !== generation) {
      throw new AgentError("REVIEW_SNAPSHOT_EXPIRED", "Review 快照已经过期，请刷新后重试", 409, {
        expected: generation,
        actual: entry.snapshot.generation,
      })
    }
    return entry
  }

  async fileDiff(input: { projectId: string; source: ReviewSource; generation: string; path: string; hideWhitespace?: boolean | undefined }): Promise<ReviewFileDiffResult> {
    const path = validateRelativePath(input.path)
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

    this.markProjectStale(input.projectId)
    const refreshed = await this.refreshSnapshot(input.projectId, input.source)
    return {
      ok: true,
      action: input.action,
      path,
      generation: refreshed.snapshot.generation,
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
