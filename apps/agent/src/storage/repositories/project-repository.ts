import { existsSync, statSync } from "node:fs"
import { basename, isAbsolute, relative, resolve } from "node:path"
import type { ModelRef } from "../../domain"
import { AgentError } from "../../domain"
import { CredentialRepositoryDatabase } from "./credential-repository"

export type ProjectModelSettings = {
  defaultModel: ModelRef | null
  instructions: string
  version: number
}

export type StoredProjectFolder = {
  id: string
  name: string
  path: string
  role: "primary" | "secondary"
  availability: "available" | "missing"
  order: number
  createdAt: number
  updatedAt: number
}

export type StoredProject = {
  id: string
  name: string
  primaryFolderId: string
  folders: StoredProjectFolder[]
  removedAt: number | null
  /** Internal compatibility alias for the primary folder. */
  rootPath: string
  lastOpenedAt: number
  createdAt: number
  updatedAt: number
  settings: ProjectModelSettings
}

type ProjectRow = {
  id: string
  name: string
  removed_at: number | null
  last_opened_at: number
  created_at: number
  updated_at: number
}

type FolderRow = {
  id: string
  project_id: string
  path: string
  role: "primary" | "secondary"
  sort_order: number
  created_at: number
  updated_at: number
}

const now = () => Date.now()
const stringify = (value: unknown) => JSON.stringify(value ?? null)
const parse = <T>(value: string): T => JSON.parse(value) as T
const canonicalPath = (value: string) => resolve(value)
export const projectPathKey = (value: string) => {
  const normalized = canonicalPath(value).replaceAll("\\", "/").replace(/\/+$/, "")
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}
const pathContains = (parent: string, candidate: string) => {
  const nested = relative(parent, candidate)
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))
}

export abstract class ProjectRepositoryDatabase extends CredentialRepositoryDatabase {
  private folders(projectID: string) {
    return (this.profileSqlite.query(`
      SELECT id, project_id, path, role, sort_order, created_at, updated_at
      FROM project_folders
      WHERE project_id = ?
      ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, sort_order, created_at, id
    `).all(projectID) as FolderRow[]).map((row): StoredProjectFolder => {
      let available = false
      try {
        available = existsSync(row.path) && statSync(row.path).isDirectory()
      } catch {
        available = false
      }
      return {
        id: row.id,
        name: basename(row.path) || row.path,
        path: row.path,
        role: row.role,
        availability: available ? "available" : "missing",
        order: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    })
  }

  private mapProject(row: ProjectRow): StoredProject {
    const folders = this.folders(row.id)
    const primary = folders.find((folder) => folder.role === "primary")
    return {
      id: row.id,
      name: row.name,
      primaryFolderId: primary?.id ?? "",
      folders,
      removedAt: row.removed_at,
      rootPath: primary?.path ?? "",
      lastOpenedAt: row.last_opened_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      settings: this.getProjectSettings(row.id),
    }
  }

  protected requireProject(projectID: string) {
    const project = this.getProject(projectID)
    if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
    if (project.removedAt !== null) throw new AgentError("PROJECT_REMOVED", "项目已被移除", 409)
    return project
  }

  requireProjectForRemoval(projectID: string) {
    return this.requireProject(projectID)
  }

  createProject(input: { id?: string; rootPath?: string; primaryPath?: string; name?: string }) {
    const primaryPath = canonicalPath(input.primaryPath ?? input.rootPath ?? "")
    const timestamp = now()
    const id = input.id ?? crypto.randomUUID()
    const folderID = crypto.randomUUID()
    const name = input.name?.trim() || basename(primaryPath) || primaryPath
    this.profileSqlite.transaction(() => {
      this.profileSqlite.query(`
        INSERT INTO projects (id, name, removed_at, created_at, updated_at, last_opened_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `).run(id, name, timestamp, timestamp, timestamp)
      this.profileSqlite.query(`
        INSERT INTO project_folders (
          id, project_id, path, path_key, role, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'primary', 0, ?, ?)
      `).run(folderID, id, primaryPath, projectPathKey(primaryPath), timestamp, timestamp)
      this.profileSqlite.query(`
        INSERT INTO project_settings (
          project_id, default_model, instructions, version, updated_at
        ) VALUES (?, NULL, '', 1, ?)
      `).run(id, timestamp)
    })()
    return this.getProject(id)!
  }

  listProjects(input: { folderPath?: string; includeRemoved?: boolean } = {}) {
    const rows = this.profileSqlite.query(`
      SELECT id, name, removed_at, last_opened_at, created_at, updated_at
      FROM projects
      ${input.includeRemoved ? "" : "WHERE removed_at IS NULL"}
      ORDER BY last_opened_at DESC, created_at DESC, id
    `).all() as ProjectRow[]
    const projects = rows.map((row) => this.mapProject(row))
    if (!input.folderPath) return projects
    const key = projectPathKey(input.folderPath)
    return projects.filter((project) => project.folders.some((folder) => projectPathKey(folder.path) === key))
  }

  getProject(projectID: string) {
    const row = this.profileSqlite.query(`
      SELECT id, name, removed_at, last_opened_at, created_at, updated_at
      FROM projects WHERE id = ?
    `).get(projectID) as ProjectRow | null
    return row ? this.mapProject(row) : null
  }

  getProjectFolder(projectID: string, folderID: string) {
    return this.requireProject(projectID).folders.find((folder) => folder.id === folderID) ?? null
  }

  touchProject(projectID: string) {
    this.requireProject(projectID)
    const timestamp = now()
    this.profileSqlite.query(
      "UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?",
    ).run(timestamp, timestamp, projectID)
    return this.getProject(projectID)!
  }

  updateProject(input: { projectID: string; name: string; expectedVersion: number }) {
    const project = this.requireProject(input.projectID)
    if (project.updatedAt !== input.expectedVersion) {
      throw new AgentError("CONFLICT", "项目已被其他操作更新", 409)
    }
    const timestamp = now()
    const changed = this.profileSqlite.query(`
      UPDATE projects SET name = ?, updated_at = ?
      WHERE id = ? AND updated_at = ? AND removed_at IS NULL
    `).run(input.name.trim(), timestamp, input.projectID, input.expectedVersion).changes
    if (changed === 0) throw new AgentError("CONFLICT", "项目已被其他操作更新", 409)
    return this.getProject(input.projectID)!
  }

  getProjectSettings(projectID: string): ProjectModelSettings {
    const row = this.profileSqlite.query(`
      SELECT default_model, instructions, version
      FROM project_settings WHERE project_id = ?
    `).get(projectID) as { default_model: string | null; instructions: string; version: number } | null
    return {
      defaultModel: row?.default_model ? parse<ModelRef>(row.default_model) : null,
      instructions: row?.instructions ?? "",
      version: row?.version ?? 1,
    }
  }

  saveProjectSettings(
    projectID: string,
    settings: { defaultModel: ModelRef | null; instructions?: string },
    expectedVersion?: number,
  ) {
    this.requireProject(projectID)
    const current = this.getProjectSettings(projectID)
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new AgentError("PROJECT_SETTINGS_CONFLICT", "项目设置已被其他操作更新", 409)
    }
    const timestamp = now()
    const nextVersion = current.version + 1
    this.profileSqlite.query(`
      INSERT INTO project_settings (
        project_id, default_model, instructions, version, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        default_model = excluded.default_model,
        instructions = excluded.instructions,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(
      projectID,
      settings.defaultModel ? stringify(settings.defaultModel) : null,
      settings.instructions ?? current.instructions,
      nextVersion,
      timestamp,
    )
    return this.getProjectSettings(projectID)
  }

  addProjectFolder(projectID: string, path: string) {
    const project = this.requireProject(projectID)
    const canonical = canonicalPath(path)
    const key = projectPathKey(canonical)
    const duplicate = project.folders.find((folder) => projectPathKey(folder.path) === key)
    if (duplicate) return { project, changed: false }
    const overlaps = project.folders.some((folder) =>
      pathContains(folder.path, canonical) || pathContains(canonical, folder.path))
    if (overlaps) throw new AgentError("PROJECT_FOLDER_OVERLAP", "同一项目中的目录不能互相包含", 409)
    const timestamp = now()
    const sortOrder = project.folders.reduce((maximum, folder) => Math.max(maximum, folder.order), 0) + 1
    const result = this.profileSqlite.query(`
      INSERT INTO project_folders (
        id, project_id, path, path_key, role, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'secondary', ?, ?, ?)
      ON CONFLICT(project_id, path_key) DO NOTHING
    `).run(crypto.randomUUID(), projectID, canonical, key, sortOrder, timestamp, timestamp)
    if (result.changes > 0) {
      this.profileSqlite.query("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, projectID)
    }
    return { project: this.getProject(projectID)!, changed: result.changes > 0 }
  }

  removeProjectFolder(projectID: string, folderID: string) {
    const project = this.requireProject(projectID)
    const folder = project.folders.find((entry) => entry.id === folderID)
    if (!folder) throw new AgentError("PROJECT_FOLDER_NOT_FOUND", "项目目录不存在", 404)
    if (folder.role === "primary") {
      throw new AgentError("PROJECT_FOLDER_IN_USE", "请先将其他目录设为主目录", 409)
    }
    const inUse = (this.sqlite.query(`
      SELECT workspace_cwd FROM threads
      WHERE project_id = ? AND archived_at IS NULL AND workspace_cwd IS NOT NULL
    `).all(projectID) as Array<{ workspace_cwd: string }>).some(({ workspace_cwd }) =>
      pathContains(folder.path, workspace_cwd))
    if (inUse) throw new AgentError("PROJECT_FOLDER_IN_USE", "仍有未归档任务使用此目录或其子目录", 409)
    const timestamp = now()
    const changes = this.profileSqlite.query(
      "DELETE FROM project_folders WHERE project_id = ? AND id = ? AND role = 'secondary'",
    ).run(projectID, folderID).changes
    if (changes > 0) {
      this.profileSqlite.query("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, projectID)
    }
    return { project: this.getProject(projectID)!, changed: changes > 0 }
  }

  setPrimaryProjectFolder(projectID: string, folderID: string) {
    const project = this.requireProject(projectID)
    const folder = project.folders.find((entry) => entry.id === folderID)
    if (!folder) throw new AgentError("PROJECT_FOLDER_NOT_FOUND", "项目目录不存在", 404)
    if (folder.role === "primary") return { project, changed: false }
    const timestamp = now()
    this.profileSqlite.transaction(() => {
      this.profileSqlite.query(
        "UPDATE project_folders SET role = 'secondary', updated_at = ? WHERE project_id = ? AND role = 'primary'",
      ).run(timestamp, projectID)
      this.profileSqlite.query(
        "UPDATE project_folders SET role = 'primary', sort_order = 0, updated_at = ? WHERE project_id = ? AND id = ?",
      ).run(timestamp, projectID, folderID)
      this.profileSqlite.query("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, projectID)
    })()
    return { project: this.getProject(projectID)!, changed: true }
  }

  removeProjectRecord(projectID: string, removedAt: number) {
    this.requireProject(projectID)
    this.profileSqlite.transaction(() => {
      this.profileSqlite.query("DELETE FROM project_sources WHERE project_id = ?").run(projectID)
      this.profileSqlite.query("DELETE FROM project_folders WHERE project_id = ?").run(projectID)
      this.profileSqlite.query(`
        UPDATE projects
        SET removed_at = ?, updated_at = ?
        WHERE id = ? AND removed_at IS NULL
      `).run(removedAt, removedAt, projectID)
    })()
  }

  resolveProjectModel(projectID: string, globalDefault: ModelRef | null) {
    return this.getProjectSettings(projectID).defaultModel ?? globalDefault
  }

  projectOperation(operationID: string) {
    const row = this.profileSqlite.query(`
      SELECT project_id, method, request_hash, status, result
      FROM project_operations WHERE operation_id = ?
    `).get(operationID) as {
      project_id: string | null
      method: string
      request_hash: string
      status: "pending" | "completed"
      result: string | null
    } | null
    return row ? {
      projectID: row.project_id,
      method: row.method,
      requestHash: row.request_hash,
      status: row.status,
      result: row.result ? parse<unknown>(row.result) : null,
    } : null
  }

  beginProjectOperation(input: { operationID: string; method: string; requestHash: string; projectID?: string }) {
    const existing = this.projectOperation(input.operationID)
    if (existing) {
      if (existing.method !== input.method || existing.requestHash !== input.requestHash) {
        throw new AgentError("CONFLICT", "operationId 已用于不同的项目操作", 409)
      }
      return existing
    }
    this.profileSqlite.query(`
      INSERT INTO project_operations (
        operation_id, project_id, method, request_hash, status, result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)
    `).run(input.operationID, input.projectID ?? null, input.method, input.requestHash, now(), now())
    return this.projectOperation(input.operationID)!
  }

  completeProjectOperation(operationID: string, result: unknown) {
    this.profileSqlite.query(`
      UPDATE project_operations
      SET status = 'completed', result = ?, updated_at = ?
      WHERE operation_id = ?
    `).run(stringify(result), now(), operationID)
    return result
  }
}

export type ProjectRepository = ProjectRepositoryDatabase
export const projectRepository = (database: ProjectRepositoryDatabase): ProjectRepository => database
