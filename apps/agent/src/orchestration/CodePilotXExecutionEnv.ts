import { ExecutionError, FileError, err, ok, type ExecutionEnv, type FileInfo, type Result } from "@codepilotx/pi-agent-core"
import { isAbsolute, join, relative, resolve } from "node:path"
import type { WorkspaceService } from "../workspace/WorkspaceService"

/**
 * Harness resource access is confined to WorkspaceService. Model-visible shell
 * and mutation always go through AgentTool -> ToolExecutor, never this env.
 */
export class CodePilotXExecutionEnv implements ExecutionEnv {
  readonly cwd: string
  constructor(
    private readonly workspace: WorkspaceService,
    defaultCwd = workspace.rootPath,
  ) {
    const relativeCwd = relative(workspace.rootPath, defaultCwd)
    if (relativeCwd.startsWith("..") || isAbsolute(relativeCwd)) {
      throw new FileError("permission_denied", "默认工作目录不在当前工作区内", defaultCwd)
    }
    this.cwd = resolve(defaultCwd)
  }

  private addressed(path: string) { return isAbsolute(path) ? resolve(path) : resolve(this.cwd, path) }
  private local(path: string) {
    const value = relative(this.workspace.rootPath, this.addressed(path))
    if (!value || value === ".") return "."
    if (value.startsWith("..") || isAbsolute(value)) throw new FileError("permission_denied", "路径不在当前工作区内", path)
    return value.replaceAll("\\", "/")
  }
  private async file<T>(path: string, operation: () => Promise<T>): Promise<Result<T, FileError>> {
    try { return ok(await operation()) }
    catch (cause) { return err(cause instanceof FileError ? cause : new FileError("unknown", "工作区文件操作失败", path, cause instanceof Error ? cause : undefined)) }
  }

  absolutePath(path: string) { return this.file(path, async () => { this.local(path); return this.addressed(path) }) }
  joinPath(parts: string[]) { return this.absolutePath(join(...parts)) }
  readTextFile(path: string, abortSignal?: AbortSignal) {
    return this.file(path, async () => {
      if (abortSignal?.aborted) throw new FileError("aborted", "读取已停止", path)
      return this.workspace.read(this.local(path), 0, 10_000)
    })
  }
  async readTextLines(path: string, options?: { maxLines?: number; abortSignal?: AbortSignal }): Promise<Result<string[], FileError>> {
    const result = await this.readTextFile(path, options?.abortSignal)
    if (!result.ok) return result
    return ok(result.value.split(/\r?\n/).slice(0, options?.maxLines))
  }
  readBinaryFile(path: string) { return Promise.resolve(err<Uint8Array, FileError>(new FileError("not_supported", "二进制资源必须通过附件服务读取", path))) }
  writeFile(path: string) { return Promise.resolve(err<void, FileError>(new FileError("permission_denied", "Harness 不可直接写工作区", path))) }
  appendFile(path: string) { return Promise.resolve(err<void, FileError>(new FileError("permission_denied", "Harness 不可直接写工作区", path))) }
  fileInfo(path: string) { return Promise.resolve(err<FileInfo, FileError>(new FileError("not_supported", "请通过 workspace 工具读取元数据", path))) }
  listDir(path: string, abortSignal?: AbortSignal) {
    return this.file(path, async () => {
      if (abortSignal?.aborted) throw new FileError("aborted", "枚举已停止", path)
      return (await this.workspace.list(this.local(path))).filter((entry) => entry.type !== "other").map((entry) => ({
        name: entry.name, path: resolve(this.workspace.rootPath, entry.path), kind: entry.type as "file" | "directory", size: 0, mtimeMs: 0,
      }))
    })
  }
  canonicalPath(path: string) { return this.absolutePath(path) }
  async exists(path: string, abortSignal?: AbortSignal): Promise<Result<boolean, FileError>> {
    const value = await this.listDir(path, abortSignal)
    if (value.ok) return ok(true)
    return value.error.code === "aborted" ? value : ok(false)
  }
  createDir(path: string) { return Promise.resolve(err<void, FileError>(new FileError("permission_denied", "Harness 不可直接创建目录", path))) }
  remove(path: string) { return Promise.resolve(err<void, FileError>(new FileError("permission_denied", "Harness 不可直接删除文件", path))) }
  createTempDir() { return Promise.resolve(err<string, FileError>(new FileError("not_supported", "Harness 临时目录已禁用"))) }
  createTempFile() { return Promise.resolve(err<string, FileError>(new FileError("not_supported", "Harness 临时文件已禁用"))) }
  exec(): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
    return Promise.resolve(err(new ExecutionError("shell_unavailable", "Harness shell 已禁用；请使用受控 shell 工具")))
  }
  async cleanup() {}
}
