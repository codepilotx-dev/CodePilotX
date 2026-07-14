import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve } from "node:path"
import { AgentError } from "../domain"

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage"])
const MAX_FILE_BYTES = 1_000_000
const SEARCH_LIMIT = 200

export interface WorkspaceSearchResult {
  path: string
  line?: number
  preview?: string
}

export interface PatchProposalDraft {
  type: "patch"
  payload: {
    path: string
    before: string
    after: string
    diff: string
    additions: number
    deletions: number
  }
}

export interface CommandProposalDraft {
  type: "command"
  payload: {
    command: string
    cwd: string
    description: string
  }
}

export type ProposalDraft = PatchProposalDraft | CommandProposalDraft

const lineCount = (value: string) => value === "" ? 0 : value.split(/\r?\n/).length

/**
 * The only file-system boundary available to agents. Every existing path is
 * resolved through realpath before use, which prevents symlinks from escaping
 * the directory selected by the user.
 */
export class WorkspaceService {
  readonly rootPath: string

  private constructor(rootPath: string) {
    this.rootPath = rootPath
  }

  static async open(rootPath: string) {
    const resolved = await realpath(resolve(rootPath))
    const metadata = await stat(resolved)
    if (!metadata.isDirectory()) throw new AgentError("WORKSPACE_NOT_DIRECTORY", "工作区路径必须是目录", 400)
    return new WorkspaceService(resolved)
  }

  private displayPath(path: string) {
    const result = relative(this.rootPath, path)
    return result === "" ? "." : result.replaceAll("\\", "/")
  }

  private ensureWithinRoot(path: string) {
    const result = relative(this.rootPath, path)
    if (result === "" || (!result.startsWith("..") && !isAbsolute(result))) return
    throw new AgentError("WORKSPACE_PATH_DENIED", "路径不在当前工作区内", 403)
  }

  private async existingPath(path: string) {
    const requested = resolve(this.rootPath, path)
    const canonical = await realpath(requested).catch(() => {
      throw new AgentError("WORKSPACE_PATH_NOT_FOUND", "工作区路径不存在或不可访问", 404)
    })
    this.ensureWithinRoot(canonical)
    return canonical
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
      .map((entry) => ({
        name: entry.name,
        path: this.displayPath(resolve(directory, entry.name)),
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }))
  }

  async read(path: string) {
    const canonical = await this.existingPath(path)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new AgentError("WORKSPACE_NOT_FILE", "路径不是文本文件", 400)
    if (metadata.size > MAX_FILE_BYTES) throw new AgentError("WORKSPACE_FILE_TOO_LARGE", `文件超过 ${MAX_FILE_BYTES} 字节读取上限`, 413)
    try {
      return await readFile(canonical, "utf8")
    } catch {
      throw new AgentError("WORKSPACE_FILE_UNREADABLE", "文件无法按 UTF-8 读取", 400)
    }
  }

  async search(path: string, query: string, signal: AbortSignal, limit = SEARCH_LIMIT): Promise<WorkspaceSearchResult[]> {
    if (!query.trim()) throw new AgentError("INVALID_TOOL_INPUT", "query 必须是非空字符串", 400)
    const root = await this.directory(path)
    const found: WorkspaceSearchResult[] = []
    const needle = query.toLowerCase()
    const visit = async (directory: string): Promise<void> => {
      if (signal.aborted || found.length >= limit) return
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (signal.aborted || found.length >= limit) return
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue
        const candidate = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(candidate)
          continue
        }
        if (!entry.isFile()) continue
        const display = this.displayPath(candidate)
        if (entry.name.toLowerCase().includes(needle)) {
          found.push({ path: display })
          continue
        }
        try {
          if ((await stat(candidate)).size > MAX_FILE_BYTES) continue
          const text = await readFile(candidate, "utf8")
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
    return found
  }

  async proposePatch(path: string, before: string, after: string): Promise<PatchProposalDraft> {
    if (!before) throw new AgentError("INVALID_TOOL_INPUT", "before 必须是非空字符串", 400)
    const current = await this.read(path)
    const index = current.indexOf(before)
    if (index < 0) throw new AgentError("PATCH_CONTEXT_NOT_FOUND", "补丁上下文未找到", 409)
    if (current.indexOf(before, index + before.length) >= 0) throw new AgentError("PATCH_CONTEXT_AMBIGUOUS", "补丁上下文不唯一", 409)
    const canonical = await this.existingPath(path)
    return {
      type: "patch",
      payload: {
        path: this.displayPath(canonical),
        before,
        after,
        diff: `--- a/${this.displayPath(canonical)}\n+++ b/${this.displayPath(canonical)}\n@@\n-${before}\n+${after}`,
        additions: lineCount(after),
        deletions: lineCount(before),
      },
    }
  }

  // Kept as the orchestration-facing spelling; ToolRegistry exposes the
  // imperative-looking `propose_patch` name to the model, but this operation
  // still only creates data and never applies a patch.
  proposalPatch(path: string, before: string, after: string) {
    return this.proposePatch(path, before, after)
  }

  async proposeCommand(command: string, cwd?: string, description?: string): Promise<CommandProposalDraft> {
    if (!command.trim()) throw new AgentError("INVALID_TOOL_INPUT", "command 必须是非空字符串", 400)
    const directory = await this.directory(cwd ?? ".")
    return {
      type: "command",
      payload: {
        command,
        cwd: this.displayPath(directory),
        description: description?.trim() || `建议在 ${basename(directory) || "工作区"} 中运行命令`,
      },
    }
  }

  proposalCommand(command: string, cwd?: string, description?: string) {
    return this.proposeCommand(command, cwd, description)
  }
}
