import { createHash, randomUUID } from "node:crypto"
import { watch as watchFileSystem } from "node:fs"
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { AgentError } from "../domain"

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage"])
const MAX_FILE_BYTES = 1_000_000
const EDITOR_READ_MAX_BYTES = 20 * 1024 * 1024
const EDITOR_WRITE_MAX_BYTES = 10 * 1024 * 1024
const SEARCH_LIMIT = 200
const LIST_LIMIT = 2_000
const SEARCH_MAX_FILES = 10_000
const SEARCH_MAX_BYTES = 50 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 10_000
const decoder = new TextDecoder("utf-8", { fatal: true })
const decodeUtf8 = (bytes: Uint8Array) => {
  try { return decoder.decode(bytes) } catch { throw new AgentError("WORKSPACE_FILE_UNREADABLE", "文件包含非法 UTF-8 字节", 400) }
}

export interface WorkspaceSearchResult {
  path: string
  line?: number
  preview?: string
}

export interface WorkspaceFileRevision {
  mtimeMs: number
  sha256: string
}

export interface WorkspaceEditorFile {
  path: string
  content: string
  sizeBytes: number
  readonly: boolean
  truncated: false
  revision: WorkspaceFileRevision
}

export interface WorkspaceFileEntry {
  name: string
  path: string
  type: "file" | "directory"
  depth: number
}

export interface WorkspaceRoot {
  folderId?: string
  path: string
  role: "primary" | "secondary"
  writable?: boolean
}

export type ApplyPatchInput =
  | { operation: "update"; path: string; before: string; after: string }
  | { operation: "create"; path: string; content: string }
  | { operation: "delete"; path: string; expectedSha256: string }

export interface ApplyPatchResult {
  operation: ApplyPatchInput["operation"]
  path: string
  diff: string
  additions: number
  deletions: number
  beforeSha256: string | null
  afterSha256: string | null
}

const lines = (value: string) => value === "" ? [] : value.replace(/\r?\n$/, "").split(/\r?\n/)
const lineCount = (value: string) => lines(value).length
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

const diffLines = (prefix: "+" | "-", value: string) =>
  lines(value).map((line) => `${prefix}${line}`)

const uniqueContextIndex = (current: string, before: string) => {
  if (!before) throw new AgentError("INVALID_TOOL_INPUT", "before 必须是非空字符串", 400)
  const index = current.indexOf(before)
  if (index < 0) throw new AgentError("PATCH_CONTEXT_NOT_FOUND", "补丁上下文未找到", 409)
  if (current.indexOf(before, index + 1) >= 0) {
    throw new AgentError("PATCH_CONTEXT_AMBIGUOUS", "补丁上下文不唯一", 409)
  }
  return index
}

const lineNumberAt = (value: string, index: number) => value.slice(0, index).split(/\r?\n/).length

const unifiedDiff = (path: string, before: string | null, after: string | null, startLine = 1) => {
  const oldLines = before === null ? 0 : lineCount(before)
  const newLines = after === null ? 0 : lineCount(after)
  const oldPath = before === null ? "/dev/null" : `a/${path}`
  const newPath = after === null ? "/dev/null" : `b/${path}`
  const oldStart = before === null ? 0 : startLine
  const newStart = after === null ? 0 : startLine
  return [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
    ...diffLines("-", before ?? ""),
    ...diffLines("+", after ?? ""),
  ].join("\n")
}

/**
 * The only file-system boundary available to agents. Every existing path is
 * resolved through realpath before use, which prevents symlinks from escaping
 * the directory selected by the user.
 */
export class WorkspaceService {
  readonly rootPath: string
  readonly roots: readonly string[]
  readonly writableRoots: readonly string[]
  readonly workspaceRoots: readonly WorkspaceRoot[]
  private readonly editorAliases = new Map<string, string>()

  private constructor(rootPath: string, workspaceRoots: readonly WorkspaceRoot[]) {
    this.rootPath = rootPath
    this.workspaceRoots = Object.freeze(workspaceRoots.map((root) => Object.freeze({ ...root })))
    this.roots = Object.freeze(this.workspaceRoots.map((root) => root.path))
    this.writableRoots = Object.freeze(this.workspaceRoots.filter((root) => root.writable !== false).map((root) => root.path))
  }

  static async open(rootPath: string) {
    return this.openRoots({
      primaryRoot: rootPath,
      roots: [{ path: rootPath, role: "primary" }],
    })
  }

  static async openRoots(input: { primaryRoot: string; roots: readonly WorkspaceRoot[] }) {
    const primary = await this.canonicalDirectory(input.primaryRoot)
    const candidates = input.roots.length > 0 ? input.roots : [{ path: primary, role: "primary" as const }]
    const roots: WorkspaceRoot[] = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      let path: string
      try {
        path = await this.canonicalDirectory(candidate.path)
      } catch (cause) {
        if (resolve(candidate.path) === resolve(input.primaryRoot)) throw cause
        continue
      }
      const key = process.platform === "win32" ? path.toLowerCase() : path
      if (seen.has(key)) continue
      seen.add(key)
      roots.push({
        ...(candidate.folderId ? { folderId: candidate.folderId } : {}),
        path,
        role: path === primary ? "primary" : "secondary",
        ...(candidate.writable === false ? { writable: false } : {}),
      })
    }
    if (!roots.some((root) => root.path === primary)) roots.unshift({ path: primary, role: "primary" })
    roots.sort((left, right) => Number(right.path === primary) - Number(left.path === primary))
    return new WorkspaceService(primary, roots)
  }

  private static async canonicalDirectory(path: string) {
    const resolved = await realpath(resolve(path)).catch(() => {
      throw new AgentError("WORKSPACE_PATH_NOT_FOUND", "工作区路径不存在或不可访问", 404)
    })
    const metadata = await stat(resolved)
    if (!metadata.isDirectory()) throw new AgentError("WORKSPACE_NOT_DIRECTORY", "工作区路径必须是目录", 400)
    return resolved
  }

  grantEditorAlias(alias: "@codepilotx/config.toml", targetPath: string) {
    if (!isAbsolute(targetPath)) throw new AgentError("WORKSPACE_PATH_DENIED", "编辑器别名目标无效", 403)
    this.editorAliases.set(alias, resolve(targetPath))
  }

  private aliasTarget(path: string) {
    if (path.startsWith("@") && !this.editorAliases.has(path)) {
      throw new AgentError("WORKSPACE_PATH_DENIED", "未知的 host 编辑器别名", 403)
    }
    return this.editorAliases.get(path)
  }

  displayPath(path: string) {
    for (const [alias, target] of this.editorAliases) {
      if (resolve(path) === target) return alias
    }
    const owner = this.rootForPath(path)
    if (owner && owner.path !== this.rootPath) return resolve(path)
    const result = relative(this.rootPath, path)
    return result === "" ? "." : result.replaceAll("\\", "/")
  }

  rootForPath(path: string) {
    const candidate = resolve(path)
    return [...this.workspaceRoots]
      .sort((left, right) => right.path.length - left.path.length)
      .find((root) => {
        const child = relative(root.path, candidate)
        return child === "" || (!child.startsWith("..") && !isAbsolute(child))
      })
  }

  containsPath(path: string) {
    return Boolean(this.rootForPath(path))
  }

  private ensureWithinRoot(path: string) {
    if (this.containsPath(path)) return
    throw new AgentError("WORKSPACE_PATH_DENIED", "路径不在当前工作区内", 403)
  }

  private ensureWritable(path: string) {
    const owner = this.rootForPath(path)
    if (owner?.writable !== false) return
    throw new AgentError("WORKSPACE_FILE_READONLY", "当前工作区目录为只读", 403)
  }

  private requestedPath(path: string) {
    const alias = this.aliasTarget(path)
    if (alias) return alias
    if (typeof path !== "string" || path.trim() === "" || (!isAbsolute(path) && path.split(/[\\/]+/).includes(".."))) {
      throw new AgentError("WORKSPACE_PATH_DENIED", "路径必须位于当前工作区内", 403)
    }
    const requested = isAbsolute(path) ? resolve(path) : resolve(this.rootPath, path)
    this.ensureWithinRoot(requested)
    return requested
  }

  async resolveExistingPath(path: string) {
    return this.existingPath(path)
  }

  async resolveDirectory(path = ".") {
    return this.directory(path)
  }

  private async existingPath(path: string) {
    const requested = this.requestedPath(path)
    const canonical = await realpath(requested).catch(() => {
      throw new AgentError("WORKSPACE_PATH_NOT_FOUND", "工作区路径不存在或不可访问", 404)
    })
    const alias = this.aliasTarget(path)
    if (alias) {
      if (canonical !== alias) throw new AgentError("WORKSPACE_PATH_DENIED", "编辑器别名不能通过符号链接重定向", 403)
    } else {
      this.ensureWithinRoot(canonical)
    }
    return canonical
  }

  private async createPath(path: string) {
    const requested = this.requestedPath(path)
    const alias = this.aliasTarget(path)
    if (!alias && path.replaceAll("\\", "/").toLowerCase() === ".codepilotx/config.toml") {
      await mkdir(dirname(requested), { recursive: true })
    }
    const parent = await realpath(dirname(requested)).catch(() => {
      throw new AgentError("WORKSPACE_PATH_NOT_FOUND", "目标文件的父目录不存在或不可访问", 404)
    })
    if (alias) {
      if (parent !== dirname(alias)) throw new AgentError("WORKSPACE_PATH_DENIED", "编辑器别名父目录无效", 403)
    } else {
      this.ensureWithinRoot(parent)
    }
    const metadata = await stat(parent)
    if (!metadata.isDirectory()) throw new AgentError("WORKSPACE_NOT_DIRECTORY", "目标文件的父路径不是目录", 400)
    const canonical = resolve(parent, basename(requested))
    if (alias) {
      if (canonical !== alias) throw new AgentError("WORKSPACE_PATH_DENIED", "编辑器别名目标无效", 403)
    } else {
      this.ensureWithinRoot(canonical)
    }
    try {
      await lstat(canonical)
      throw new AgentError("WORKSPACE_PATH_EXISTS", "目标文件已存在", 409)
    } catch (error) {
      if (error instanceof AgentError) throw error
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AgentError("WORKSPACE_PATH_UNREADABLE", "目标文件状态无法确认", 400)
      }
    }
    return canonical
  }

  private async replaceAtomically(path: string, content: string, mode?: number, maxBytes = MAX_FILE_BYTES) {
    this.ensureWritable(path)
    if (Buffer.byteLength(content, "utf8") > maxBytes) throw new AgentError("WORKSPACE_FILE_TOO_LARGE", `最终文件超过 ${maxBytes} 字节上限`, 413)
    const temporary = resolve(dirname(path), `.codepilotx-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content, { encoding: "utf8", flag: "wx" })
      if (mode !== undefined) await chmod(temporary, mode)
      await rename(temporary, path)
    } catch {
      await unlink(temporary).catch(() => undefined)
      throw new AgentError("WORKSPACE_WRITE_FAILED", "无法原子写入工作区文件", 500)
    }
  }

  private async directory(path?: string) {
    const canonical = await this.existingPath(path ?? ".")
    const metadata = await stat(canonical)
    if (!metadata.isDirectory()) throw new AgentError("WORKSPACE_NOT_DIRECTORY", "路径不是目录", 400)
    return canonical
  }

  async list(path = ".") {
    const directory = await this.directory(path)
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
      .slice(0, LIST_LIMIT)
      .map((entry) => ({
        name: entry.name,
        path: this.displayPath(resolve(directory, entry.name)),
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }))
  }

  async listEditorFiles(path = "."): Promise<WorkspaceFileEntry[]> {
    const directory = await this.directory(path || ".")
    const directoryPath = this.displayPath(directory)
    const depth = directoryPath === "." ? 0 : directoryPath.split("/").length
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => {
      const typeOrder = Number(right.isDirectory()) - Number(left.isDirectory())
      return typeOrder || left.name.localeCompare(right.name)
    })

    const result: WorkspaceFileEntry[] = []
    for (const entry of entries) {
      if (result.length >= LIST_LIMIT) break
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue
      if (!entry.isDirectory() && !entry.isFile()) continue

      const entryPath = resolve(directory, entry.name)
      this.ensureWithinRoot(entryPath)
      result.push({
        name: entry.name,
        path: this.displayPath(entryPath),
        type: entry.isDirectory() ? "directory" : "file",
        depth,
      })
    }
    return result
  }

  async read(path: string, offset = 0, limit = 400) {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    if (metadata.size > MAX_FILE_BYTES) throw new AgentError("WORKSPACE_FILE_TOO_LARGE", `文件超过 ${MAX_FILE_BYTES} 字节读取上限`, 413)
    try {
      const text = decodeUtf8(await readFile(canonical))
      const fileLines = text.split(/\r?\n/)
      return fileLines.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, Math.min(10_000, limit))).join("\n")
    } catch {
      throw new AgentError("WORKSPACE_FILE_UNREADABLE", "文件无法按 UTF-8 读取", 400)
    }
  }

  async readEditorFile(path: string): Promise<WorkspaceEditorFile> {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    if (metadata.size > EDITOR_READ_MAX_BYTES) {
      throw new AgentError("WORKSPACE_FILE_TOO_LARGE", `文件超过 ${EDITOR_READ_MAX_BYTES} 字节编辑器读取上限`, 413, {
        sizeBytes: metadata.size,
        maxBytes: EDITOR_READ_MAX_BYTES,
      })
    }
    let content: string
    try {
      content = decodeUtf8(await readFile(canonical))
    } catch (cause) {
      if (cause instanceof AgentError) throw cause
      throw new AgentError("WORKSPACE_FILE_UNREADABLE", "文件无法按 UTF-8 读取", 400)
    }
    const current = await stat(canonical)
    if (!current.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    return {
      path: this.displayPath(canonical),
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      readonly: current.size > EDITOR_WRITE_MAX_BYTES,
      truncated: false,
      revision: { mtimeMs: current.mtimeMs, sha256: sha256(content) },
    }
  }

  async watchEditorFile(path: string, onChange: (path: string) => void) {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    const displayPath = this.displayPath(canonical)
    let debounce: ReturnType<typeof setTimeout> | undefined
    const watcher = watchFileSystem(canonical, { persistent: false }, () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => onChange(displayPath), 50)
    })
    watcher.on("error", () => {
      if (debounce) clearTimeout(debounce)
    })
    return {
      path: displayPath,
      close: () => {
        if (debounce) clearTimeout(debounce)
        watcher.close()
      },
    }
  }

  async resolveEditorFilePath(path: string) {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    return this.displayPath(canonical)
  }

  async saveEditorFile(path: string, content: string, expectedRevision: WorkspaceFileRevision) {
    if (!Number.isFinite(expectedRevision.mtimeMs) || expectedRevision.mtimeMs < 0 || !/^[a-f\d]{64}$/i.test(expectedRevision.sha256)) {
      throw new AgentError("INVALID_REQUEST", "expectedRevision 参数无效", 400)
    }
    const contentBytes = Buffer.byteLength(content, "utf8")
    if (contentBytes > EDITOR_WRITE_MAX_BYTES) {
      throw new AgentError("WORKSPACE_FILE_READONLY", `编辑器只允许保存不超过 ${EDITOR_WRITE_MAX_BYTES} 字节的文件`, 413, {
        sizeBytes: contentBytes,
        maxBytes: EDITOR_WRITE_MAX_BYTES,
      })
    }
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    if (metadata.size > EDITOR_WRITE_MAX_BYTES) {
      throw new AgentError("WORKSPACE_FILE_READONLY", `超过 ${EDITOR_WRITE_MAX_BYTES} 字节的文件为只读`, 409, {
        sizeBytes: metadata.size,
        maxBytes: EDITOR_WRITE_MAX_BYTES,
      })
    }
    const current = await readFile(canonical).then(decodeUtf8).catch((cause) => {
      if (cause instanceof AgentError) throw cause
      throw new AgentError("WORKSPACE_FILE_UNREADABLE", "文件无法按 UTF-8 读取", 400)
    })
    const currentRevision = { mtimeMs: metadata.mtimeMs, sha256: sha256(current) }
    if (currentRevision.mtimeMs !== expectedRevision.mtimeMs || currentRevision.sha256 !== expectedRevision.sha256.toLowerCase()) {
      return { outcome: "conflict" as const, revision: currentRevision }
    }
    await this.replaceAtomically(canonical, content, metadata.mode, EDITOR_WRITE_MAX_BYTES)
    const saved = await stat(canonical)
    return {
      outcome: "saved" as const,
      revision: { mtimeMs: saved.mtimeMs, sha256: sha256(content) },
    }
  }

  async search(path: string, query: string, signal: AbortSignal, limit = SEARCH_LIMIT): Promise<WorkspaceSearchResult[]> {
    if (!query.trim()) throw new AgentError("INVALID_TOOL_INPUT", "query 必须是非空字符串", 400)
    const root = await this.directory(path)
    const found: WorkspaceSearchResult[] = []
    const needle = query.toLowerCase()
    const deadline = Date.now() + SEARCH_TIMEOUT_MS
    let visitedFiles = 0
    let readBytes = 0
    const visit = async (directory: string): Promise<void> => {
      if (signal.aborted || found.length >= limit || visitedFiles >= SEARCH_MAX_FILES || readBytes >= SEARCH_MAX_BYTES || Date.now() >= deadline) return
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (signal.aborted || found.length >= limit || visitedFiles >= SEARCH_MAX_FILES || readBytes >= SEARCH_MAX_BYTES || Date.now() >= deadline) return
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue
        const candidate = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(candidate)
          continue
        }
        if (!entry.isFile()) continue
        visitedFiles += 1
        const display = this.displayPath(candidate)
        if (entry.name.toLowerCase().includes(needle)) {
          found.push({ path: display })
          continue
        }
        try {
          const size = (await stat(candidate)).size
          if (size > MAX_FILE_BYTES || readBytes + size > SEARCH_MAX_BYTES) continue
          readBytes += size
          const text = decodeUtf8(await readFile(candidate))
          const lines = text.split(/\r?\n/)
          const index = lines.findIndex((line) => line.toLowerCase().includes(needle))
          if (index >= 0) {
            const preview = lines[index]?.trim()
            found.push({ path: display, line: index + 1, ...(preview === undefined ? {} : { preview }) })
          }
        } catch {
          // Binary and unreadable files are deliberately skipped.
        }
      }
    }
    await visit(root)
    if (signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    if (Date.now() >= deadline) throw new AgentError("WORKSPACE_SEARCH_TIMEOUT", "工作区搜索超过 10 秒预算", 408)
    return found
  }

  async applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult> {
    if (input.operation === "create") {
      if (Buffer.byteLength(input.content, "utf8") > MAX_FILE_BYTES) throw new AgentError("WORKSPACE_FILE_TOO_LARGE", `最终文件超过 ${MAX_FILE_BYTES} 字节上限`, 413)
      const canonical = await this.createPath(input.path)
      await this.replaceAtomically(canonical, input.content)
      const path = this.displayPath(canonical)
      return {
        operation: input.operation,
        path,
        diff: unifiedDiff(path, null, input.content),
        additions: lineCount(input.content),
        deletions: 0,
        beforeSha256: null,
        afterSha256: sha256(input.content),
      }
    }

    const canonical = await this.existingPath(input.path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    if (metadata.size > MAX_FILE_BYTES) throw new AgentError("WORKSPACE_FILE_TOO_LARGE", `文件超过 ${MAX_FILE_BYTES} 字节读取上限`, 413)
    const current = await readFile(canonical).then(decodeUtf8).catch(() => {
      throw new AgentError("WORKSPACE_FILE_UNREADABLE", "文件无法按 UTF-8 读取", 400)
    })
    const path = this.displayPath(canonical)
    const beforeSha256 = sha256(current)

    if (input.operation === "delete") {
      if (!/^[a-f\d]{64}$/i.test(input.expectedSha256)) {
        throw new AgentError("INVALID_TOOL_INPUT", "expectedSha256 必须是 64 位十六进制 SHA-256", 400)
      }
      if (input.expectedSha256.toLowerCase() !== beforeSha256) {
        throw new AgentError("PATCH_SHA256_MISMATCH", "文件内容已变化，拒绝删除", 409)
      }
      this.ensureWritable(canonical)
      await unlink(canonical)
      return {
        operation: input.operation,
        path,
        diff: unifiedDiff(path, current, null),
        additions: 0,
        deletions: lineCount(current),
        beforeSha256,
        afterSha256: null,
      }
    }

    const index = uniqueContextIndex(current, input.before)
    const updated = `${current.slice(0, index)}${input.after}${current.slice(index + input.before.length)}`
    if (Buffer.byteLength(updated, "utf8") > MAX_FILE_BYTES) throw new AgentError("WORKSPACE_FILE_TOO_LARGE", `最终文件超过 ${MAX_FILE_BYTES} 字节上限`, 413)
    await this.replaceAtomically(canonical, updated, metadata.mode)
    return {
      operation: input.operation,
      path,
      diff: unifiedDiff(path, input.before, input.after, lineNumberAt(current, index)),
      additions: lineCount(input.after),
      deletions: lineCount(input.before),
      beforeSha256,
      afterSha256: sha256(updated),
    }
  }

}
