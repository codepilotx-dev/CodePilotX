import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { AgentError } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import {
  WorkspaceIsolationService,
  type BaselineMetadata,
  type WorkspaceDiff,
} from "./WorkspaceIsolationService"
import type { SubagentWorkspaceProvider } from "./SubagentService"

type PersistedWorkspace = {
  mode: "shared" | "worktree"
  state: "ready" | "preparing" | "conflict" | "applied" | "discarded"
  rootPath: string | null
  baselineRef: string | null
  isolation?: BaselineMetadata
  outputPatchSha256?: string
}

const within = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

export class SubagentWorkspaceCoordinator implements SubagentWorkspaceProvider {
  private readonly services = new Map<string, Promise<WorkspaceIsolationService>>()

  constructor(private readonly db: AgentDatabase, private readonly dataDir: string) {}

  async prepare(taskID: string, rootPath: string, mode: "shared" | "worktree") {
    const service = await this.service(rootPath)
    const stored = this.workspace(taskID)
    if (stored.isolation) {
      await service.adoptBaseline(stored.isolation, mode === "worktree" ? taskID : undefined)
      return { rootPath: stored.isolation.workspacePath, baselineRef: stored.isolation.ref }
    }
    if (service.repository.kind !== "git") {
      if (mode === "worktree") throw new AgentError("NON_GIT_WRITE_UNAVAILABLE", "非 Git 工作区不能创建可写子 Agent worktree", 409)
      return { rootPath: service.repository.rootPath, baselineRef: null }
    }
    const baseline = mode === "worktree"
      ? await service.createWorktree(taskID)
      : await service.captureSharedBaseline()
    this.update(taskID, { mode, state: "ready", rootPath: baseline.workspacePath, baselineRef: baseline.ref, isolation: baseline })
    return { rootPath: baseline.workspacePath, baselineRef: baseline.ref }
  }

  async finalize(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    const diff = await service.diff(baseline)
    this.update(taskID, { ...this.workspace(taskID), outputPatchSha256: diff.sha256 })
    return diff
  }

  async diff(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    return service.diff(baseline)
  }

  async apply(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    if (baseline.mode !== "worktree") throw new AgentError("WORKTREE_UNAVAILABLE", "shared 子 Agent 不能使用 worktree apply", 409)
    const diff = await service.diff(baseline)
    const preflight = await service.preflightThreeWay(diff.patch)
    if (preflight.status === "conflict") {
      this.update(taskID, { ...this.workspace(taskID), state: "conflict" })
      throw new AgentError("WORKTREE_CONFLICT", "子 Agent 变更与父工作区冲突，父工作区未修改", 409, preflight)
    }
    const applied = await service.applyThreeWay(preflight.token)
    if (applied.status !== "applied") {
      const code = applied.status === "stale" ? "WORKTREE_CONFLICT" : "WORKTREE_APPLY_FAILED"
      throw new AgentError(code, applied.status === "stale" ? "父工作区在预检后发生变化，未应用子 Agent 变更" : "子 Agent 变更应用失败", 409, applied)
    }
    const cleanup = await service.complete(taskID)
    this.update(taskID, { ...this.workspace(taskID), state: "applied", rootPath: baseline.sourceRoot })
    return { applied, cleanup }
  }

  async discard(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    const cleanup = baseline.mode === "worktree"
      ? await service.discard(taskID)
      : await service.releaseSharedBaseline(baseline).then(() => ({ workspaceID: taskID, disposition: "discarded" as const, path: baseline.workspacePath }))
    this.update(taskID, { ...this.workspace(taskID), state: "discarded", rootPath: baseline.sourceRoot })
    return cleanup
  }

  async restore(taskID: string) {
    const stored = this.workspace(taskID)
    const { service, baseline } = await this.context(taskID)
    if (baseline.mode !== "shared" || baseline.repositoryKind !== "git") throw new AgentError("NON_GIT_WRITE_UNAVAILABLE", "只有 Git shared writer 支持安全恢复", 409)
    if (!stored.outputPatchSha256) throw new AgentError("SUBAGENT_RESTORE_UNAVAILABLE", "子 Agent 尚未记录可恢复产物", 409)
    const current = await service.diff(baseline)
    if (current.sha256 !== stored.outputPatchSha256) throw new AgentError("WORKTREE_CONFLICT", "父工作区文件已在子 Agent 完成后变化，拒绝覆盖", 409)
    await this.gitApplyReverse(baseline.sourceRoot, current)
    await service.releaseSharedBaseline(baseline)
    this.update(taskID, { ...stored, state: "discarded", rootPath: baseline.sourceRoot })
    return { restored: true, sha256: current.sha256 }
  }

  private async context(taskID: string) {
    const stored = this.workspace(taskID)
    if (!stored.isolation) throw new AgentError("SUBAGENT_BASELINE_UNKNOWN", "子 Agent 尚未建立工作区基线", 404)
    const service = await this.service(stored.isolation.sourceRoot)
    await service.adoptBaseline(stored.isolation, stored.mode === "worktree" ? taskID : undefined)
    return { service, baseline: stored.isolation }
  }

  private workspace(taskID: string) {
    const row = this.db.sqlite.query("SELECT workspace_state FROM subagent_tasks WHERE id = ?").get(taskID) as { workspace_state: string } | null
    if (!row) throw new AgentError("SUBAGENT_NOT_FOUND", "子 Agent 不存在", 404)
    return JSON.parse(row.workspace_state) as PersistedWorkspace
  }

  private update(taskID: string, value: PersistedWorkspace) {
    this.db.sqlite.query("UPDATE subagent_tasks SET workspace_state = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(value), Date.now(), taskID)
  }

  private service(rootPath: string) {
    const canonical = resolve(rootPath)
    let opened = this.services.get(canonical)
    if (!opened) {
      const configured = resolve(this.dataDir)
      const base = within(canonical, configured) || within(configured, canonical)
        ? join(homedir(), ".codepilotx", "subagent-data")
        : configured
      const key = createHash("sha256").update(canonical.toLowerCase()).digest("hex").slice(0, 16)
      opened = WorkspaceIsolationService.open(canonical, join(base, "workspaces", key))
      this.services.set(canonical, opened)
    }
    return opened
  }

  private async gitApplyReverse(rootPath: string, diff: WorkspaceDiff) {
    const run = async (check: boolean) => {
      const child = Bun.spawn(["git", "apply", "--reverse", "--binary", ...(check ? ["--check"] : []), "-"], {
        cwd: rootPath,
        stdin: new Blob([diff.patch]),
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
      if (code !== 0) throw new AgentError("WORKTREE_CONFLICT", check ? "当前文件不再匹配子 Agent 产物，拒绝恢复" : "恢复子 Agent 变更失败", 409, stderr.slice(0, 4_000))
    }
    await run(true)
    await run(false)
  }
}
