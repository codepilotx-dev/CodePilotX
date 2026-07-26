import { createHash } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import type { ModelRef } from "../domain"
import { AgentError } from "../domain"
import type { RepositoryDatabase } from "../storage/repositories/RepositoryDatabase"
import type { ProjectSourceService } from "./ProjectSourceService"

const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

const requireDirectory = async (path: string) => {
  let canonical: string
  try {
    canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error("not a directory")
  } catch {
    throw new AgentError("PATH_DENIED", "所选路径不是可访问的目录", 400)
  }
  return canonical
}

export class ProjectService {
  constructor(
    private readonly db: RepositoryDatabase,
    private readonly sources?: ProjectSourceService,
  ) {}

  list(input: { folderPath?: string } = {}) {
    return this.db.listProjects(input)
  }

  async create(input: {
    name?: string
    primaryPath: string
    operationID: string
  }) {
    const primaryPath = await requireDirectory(input.primaryPath)
    const hash = requestHash({ name: input.name?.trim() || null, primaryPath })
    const projectID = crypto.randomUUID()
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/create",
      requestHash: hash,
      projectID,
    })
    if (operation.status === "completed") return operation.result as { project: ReturnType<RepositoryDatabase["getProject"]> }
    const effectiveProjectID = operation.projectID ?? projectID
    const existing = this.db.getProject(effectiveProjectID)
    const project = existing ?? this.db.createProject({
      id: effectiveProjectID,
      primaryPath,
      ...(input.name ? { name: input.name } : {}),
    })
    const result = { project }
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  open(input: { projectID: string; operationID: string }) {
    const hash = requestHash({ projectID: input.projectID })
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/open",
      requestHash: hash,
      projectID: input.projectID,
    })
    if (operation.status === "completed") return operation.result as { project: NonNullable<ReturnType<RepositoryDatabase["getProject"]>> }
    const result = { project: this.db.touchProject(input.projectID) }
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  update(input: {
    projectID: string
    name: string
    expectedVersion: number
    operationID: string
  }) {
    const hash = requestHash(input)
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/update",
      requestHash: hash,
      projectID: input.projectID,
    })
    if (operation.status === "completed") return operation.result as { project: NonNullable<ReturnType<RepositoryDatabase["getProject"]>> }
    const result = {
      project: this.db.updateProject({
        projectID: input.projectID,
        name: input.name,
        expectedVersion: input.expectedVersion,
      }),
    }
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  async addFolder(input: { projectID: string; path: string; operationID: string }) {
    const path = await requireDirectory(input.path)
    const hash = requestHash({ projectID: input.projectID, path })
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/folder/add",
      requestHash: hash,
      projectID: input.projectID,
    })
    if (operation.status === "completed") return operation.result as ReturnType<RepositoryDatabase["addProjectFolder"]>
    const result = this.db.addProjectFolder(input.projectID, path)
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  removeFolder(input: { projectID: string; folderID: string; operationID: string }) {
    const hash = requestHash(input)
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/folder/remove",
      requestHash: hash,
      projectID: input.projectID,
    })
    if (operation.status === "completed") return operation.result as ReturnType<RepositoryDatabase["removeProjectFolder"]>
    const result = this.db.removeProjectFolder(input.projectID, input.folderID)
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  setPrimaryFolder(input: { projectID: string; folderID: string; operationID: string }) {
    const hash = requestHash(input)
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/folder/set-primary",
      requestHash: hash,
      projectID: input.projectID,
    })
    if (operation.status === "completed") return operation.result as ReturnType<RepositoryDatabase["setPrimaryProjectFolder"]>
    const result = this.db.setPrimaryProjectFolder(input.projectID, input.folderID)
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  updateSettings(input: {
    projectID: string
    settings: { defaultModel?: ModelRef | null; instructions?: string }
    expectedVersion: number
    operationID: string
  }) {
    const hash = requestHash(input)
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/settings/update",
      requestHash: hash,
      projectID: input.projectID,
    })
    if (operation.status === "completed") {
      return operation.result as { projectId: string; settings: ReturnType<RepositoryDatabase["getProjectSettings"]>; version: number }
    }
    const current = this.db.getProjectSettings(input.projectID)
    const saved = this.db.saveProjectSettings(input.projectID, {
      defaultModel: input.settings.defaultModel === undefined ? current.defaultModel : input.settings.defaultModel,
      instructions: input.settings.instructions ?? current.instructions,
    }, input.expectedVersion)
    const result = { projectId: input.projectID, settings: saved, version: saved.version }
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  async remove(input: { projectID: string; operationID: string }) {
    const hash = requestHash({ projectID: input.projectID })
    const existingOperation = this.db.projectOperation(input.operationID)
    if (existingOperation) {
      const operation = this.db.beginProjectOperation({
        operationID: input.operationID,
        method: "project/remove",
        requestHash: hash,
        projectID: input.projectID,
      })
      if (operation.status === "completed") {
        return operation.result as { projectId: string; removedAt: number; archivedThreadCount: number }
      }
    }
    const existingProject = this.db.getProject(input.projectID)
    if (existingProject?.removedAt) {
      const archivedThreadCount = Number((this.db.sqlite.query(`
        SELECT COUNT(*) AS count FROM threads
        WHERE project_id = ? AND archived_at IS NOT NULL
      `).get(input.projectID) as { count: number }).count)
      const result = {
        projectId: input.projectID,
        removedAt: existingProject.removedAt,
        archivedThreadCount,
      }
      this.db.completeProjectOperation(input.operationID, result)
      return result
    }
    this.db.requireProjectForRemoval(input.projectID)
    const running = this.db.sqlite.query(`
      SELECT 1 AS present
      FROM turns AS turn
      INNER JOIN threads AS thread ON thread.id = turn.thread_id
      WHERE thread.project_id = ?
        AND turn.status IN (
          'queued', 'running', 'waiting_permission', 'waiting_question',
          'waiting_subagents'
        )
      LIMIT 1
    `).get(input.projectID)
    if (running) throw new AgentError("PROJECT_BUSY", "项目仍有运行中的任务", 409)
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: "project/remove",
      requestHash: hash,
      projectID: input.projectID,
    })
    if (operation.status === "completed") {
      return operation.result as { projectId: string; removedAt: number; archivedThreadCount: number }
    }
    const removedAt = Date.now()
    const archivedThreadCount = this.db.sqlite.query(`
      UPDATE threads
      SET archived_at = COALESCE(archived_at, ?), updated_at = ?
      WHERE project_id = ? AND archived_at IS NULL
    `).run(removedAt, removedAt, input.projectID).changes
    await this.sources?.removeAll(input.projectID)
    this.db.removeProjectRecord(input.projectID, removedAt)
    const result = { projectId: input.projectID, removedAt, archivedThreadCount }
    this.db.completeProjectOperation(input.operationID, result)
    return result
  }

  async recoverPendingRemovals() {
    const operations = this.db.profileSqlite.query(`
      SELECT operation_id, project_id
      FROM project_operations
      WHERE method = 'project/remove' AND status = 'pending' AND project_id IS NOT NULL
      ORDER BY created_at, operation_id
    `).all() as Array<{ operation_id: string; project_id: string }>
    const recovered: string[] = []
    for (const operation of operations) {
      try {
        await this.remove({
          projectID: operation.project_id,
          operationID: operation.operation_id,
        })
        recovered.push(operation.operation_id)
      } catch (cause) {
        if (!(cause instanceof AgentError) || cause.code !== "PROJECT_BUSY") throw cause
      }
    }
    return recovered
  }
}
