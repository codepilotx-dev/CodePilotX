/**
 * 插件平台仓储：plugin_* 表的唯一 SQL 来源。
 *
 * 所有 SQL 只存在于本文件；service 与 Installer 不得内联 SQL。
 * 表位于 profile 库（schema 4），与 history 库无外键关系。
 */

import type { AgentDatabase } from "../database/AgentDatabase"

export type PluginTier = "application" | "system"
export type PluginPackageSource = "package" | "linked-directory"
export type PluginGenerationKind = "application" | "system"
export type PluginGenerationStatus = "staged" | "active" | "last-good" | "retired" | "failed"
export type PluginOperationStatus = "pending" | "completed" | "failed"
export type PluginKvScope = "global" | "workspace"

export interface StoredPluginPackage {
  pluginId: string
  version: string
  displayName: string
  description: string
  publisher: string
  tier: PluginTier
  manifestJson: string
  digest: string
  source: PluginPackageSource
  linkedPath: string | null
  directoryDigest: string | null
  stagedDirectoryDigest: string | null
  installedPath: string
  installedAt: number
  updatedAt: number
}

export interface PluginActivationRow {
  pluginId: string
  /** 空字符串 = global；否则为 workspace key。 */
  workspaceKey: string
  enabled: boolean
  updatedAt: number
}

export interface PluginGrantRow {
  pluginId: string
  digest: string
  permissionId: string
  granted: boolean
  grantedAt: number
}

export interface PluginGenerationRow {
  id: string
  pluginId: string
  kind: PluginGenerationKind
  version: string
  digest: string
  status: PluginGenerationStatus
  configJson: string
  createdAt: number
  updatedAt: number
}

export interface PluginOperationRow {
  operationId: string
  pluginId: string
  method: string
  requestHash: string
  status: PluginOperationStatus
  result: string | null
  errorCode: string | null
  createdAt: number
  updatedAt: number
}

export interface PluginKvEntry {
  pluginId: string
  scope: PluginKvScope
  workspaceKey: string
  key: string
  value: string
  version: number
  updatedAt: number
}

type PackageRow = {
  plugin_id: string
  version: string
  display_name: string
  description: string
  publisher: string
  tier: PluginTier
  manifest_json: string
  digest: string
  source: PluginPackageSource
  linked_path: string | null
  directory_digest: string | null
  staged_directory_digest: string | null
  installed_path: string
  installed_at: number
  updated_at: number
}

const mapPackage = (row: PackageRow): StoredPluginPackage => ({
  pluginId: row.plugin_id,
  version: row.version,
  displayName: row.display_name,
  description: row.description,
  publisher: row.publisher,
  tier: row.tier,
  manifestJson: row.manifest_json,
  digest: row.digest,
  source: row.source,
  linkedPath: row.linked_path,
  directoryDigest: row.directory_digest,
  stagedDirectoryDigest: row.staged_directory_digest,
  installedPath: row.installed_path,
  installedAt: row.installed_at,
  updatedAt: row.updated_at,
})

export class PluginRepository {
  constructor(private readonly db: AgentDatabase) {}

  private get profile() {
    return this.db.profileSqlite
  }

  // ── app_settings（profile 级共享设置；如 pending System Profile 指针） ─

  getAppSetting(key: string): string | null {
    const row = this.profile.query("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | null
    return row?.value ?? null
  }

  setAppSetting(key: string, value: string): void {
    this.profile.query(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now())
  }

  deleteAppSetting(key: string): void {
    this.profile.query("DELETE FROM app_settings WHERE key = ?").run(key)
  }

  // ── packages ───────────────────────────────────────────────────────────

  upsertPackage(input: {
    pluginId: string
    version: string
    displayName: string
    description: string
    publisher: string
    tier: PluginTier
    manifestJson: string
    digest: string
    source: PluginPackageSource
    linkedPath: string | null
    directoryDigest: string | null
    stagedDirectoryDigest: string | null
    installedPath: string
  }): StoredPluginPackage {
    const now = Date.now()
    this.profile.query(`
      INSERT INTO plugin_packages (
        plugin_id, version, display_name, description, publisher, tier, manifest_json,
        digest, source, linked_path, directory_digest, staged_directory_digest,
        installed_path, installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        version = excluded.version,
        display_name = excluded.display_name,
        description = excluded.description,
        publisher = excluded.publisher,
        tier = excluded.tier,
        manifest_json = excluded.manifest_json,
        digest = excluded.digest,
        source = excluded.source,
        linked_path = excluded.linked_path,
        directory_digest = excluded.directory_digest,
        staged_directory_digest = excluded.staged_directory_digest,
        installed_path = excluded.installed_path,
        updated_at = excluded.updated_at
    `).run(
      input.pluginId,
      input.version,
      input.displayName,
      input.description,
      input.publisher,
      input.tier,
      input.manifestJson,
      input.digest,
      input.source,
      input.linkedPath,
      input.directoryDigest,
      input.stagedDirectoryDigest,
      input.installedPath,
      now,
      now,
    )
    return this.getPackage(input.pluginId)!
  }

  getPackage(pluginId: string): StoredPluginPackage | null {
    const row = this.profile.query(`
      SELECT plugin_id, version, display_name, description, publisher, tier, manifest_json,
        digest, source, linked_path, directory_digest, staged_directory_digest,
        installed_path, installed_at, updated_at
      FROM plugin_packages WHERE plugin_id = ?
    `).get(pluginId) as PackageRow | null
    return row ? mapPackage(row) : null
  }

  listPackages(): StoredPluginPackage[] {
    const rows = this.profile.query(`
      SELECT plugin_id, version, display_name, description, publisher, tier, manifest_json,
        digest, source, linked_path, directory_digest, staged_directory_digest,
        installed_path, installed_at, updated_at
      FROM plugin_packages ORDER BY plugin_id
    `).all() as PackageRow[]
    return rows.map(mapPackage)
  }

  removePackage(pluginId: string): void {
    this.profile.transaction(() => {
      this.profile.query("DELETE FROM plugin_packages WHERE plugin_id = ?").run(pluginId)
      this.profile.query("DELETE FROM plugin_activations WHERE plugin_id = ?").run(pluginId)
      this.profile.query("DELETE FROM plugin_grants WHERE plugin_id = ?").run(pluginId)
      this.profile.query("DELETE FROM plugin_profile_generations WHERE plugin_id = ? AND kind = 'application'").run(pluginId)
      this.profile.query("DELETE FROM plugin_operations WHERE plugin_id = ?").run(pluginId)
    })()
  }

  /** 开发目录链接：记录重算出的 staged digest（不自动执行）。 */
  setStagedDirectoryDigest(pluginId: string, stagedDigest: string | null): void {
    this.profile.query("UPDATE plugin_packages SET staged_directory_digest = ?, updated_at = ? WHERE plugin_id = ?")
      .run(stagedDigest, Date.now(), pluginId)
  }

  // ── activations ────────────────────────────────────────────────────────

  /** 安装/更新后调用：digest 变化时把 enablement 重置为 disabled。 */
  resetActivation(pluginId: string): void {
    this.profile.query(`
      INSERT INTO plugin_activations (plugin_id, workspace_key, enabled, updated_at)
      VALUES (?, '', 0, ?)
      ON CONFLICT(plugin_id, workspace_key) DO UPDATE SET enabled = 0, updated_at = excluded.updated_at
    `).run(pluginId, Date.now())
  }

  setActivation(pluginId: string, workspaceKey: string, enabled: boolean): void {
    const now = Date.now()
    this.profile.query(`
      INSERT INTO plugin_activations (plugin_id, workspace_key, enabled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(plugin_id, workspace_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(pluginId, workspaceKey, enabled ? 1 : 0, now)
  }

  getActivation(pluginId: string, workspaceKey = ""): PluginActivationRow | null {
    const row = this.profile.query(`
      SELECT plugin_id, workspace_key, enabled, updated_at
      FROM plugin_activations WHERE plugin_id = ? AND workspace_key = ?
    `).get(pluginId, workspaceKey) as { plugin_id: string; workspace_key: string; enabled: number; updated_at: number } | null
    return row ? { pluginId: row.plugin_id, workspaceKey: row.workspace_key, enabled: row.enabled === 1, updatedAt: row.updated_at } : null
  }

  listActivations(pluginId?: string): PluginActivationRow[] {
    const rows = (pluginId === undefined
      ? this.profile.query("SELECT plugin_id, workspace_key, enabled, updated_at FROM plugin_activations ORDER BY plugin_id, workspace_key").all()
      : this.profile.query("SELECT plugin_id, workspace_key, enabled, updated_at FROM plugin_activations WHERE plugin_id = ? ORDER BY workspace_key").all(pluginId)) as Array<{ plugin_id: string; workspace_key: string; enabled: number; updated_at: number }>
    return rows.map((row) => ({ pluginId: row.plugin_id, workspaceKey: row.workspace_key, enabled: row.enabled === 1, updatedAt: row.updated_at }))
  }

  // ── grants（信任按 digest 隔离；新 digest 无行 = 未批准） ─────────────

  setGrant(pluginId: string, digest: string, permissionId: string, granted: boolean): void {
    const now = Date.now()
    this.profile.query(`
      INSERT INTO plugin_grants (plugin_id, digest, permission_id, granted, granted_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(plugin_id, digest, permission_id) DO UPDATE SET granted = excluded.granted, granted_at = excluded.granted_at
    `).run(pluginId, digest, permissionId, granted ? 1 : 0, now)
  }

  listGrants(pluginId: string): PluginGrantRow[] {
    const rows = this.profile.query(`
      SELECT plugin_id, digest, permission_id, granted, granted_at
      FROM plugin_grants WHERE plugin_id = ? ORDER BY digest, permission_id
    `).all(pluginId) as Array<{ plugin_id: string; digest: string; permission_id: string; granted: number; granted_at: number }>
    return rows.map((row) => ({ pluginId: row.plugin_id, digest: row.digest, permissionId: row.permission_id, granted: row.granted === 1, grantedAt: row.granted_at }))
  }

  hasGrant(pluginId: string, digest: string, permissionId: string): boolean {
    const row = this.profile.query(`
      SELECT granted FROM plugin_grants WHERE plugin_id = ? AND digest = ? AND permission_id = ?
    `).get(pluginId, digest, permissionId) as { granted: number } | null
    return row?.granted === 1
  }

  // ── generations ────────────────────────────────────────────────────────

  insertGeneration(input: {
    id: string
    pluginId: string
    kind: PluginGenerationKind
    version: string
    digest: string
    status: PluginGenerationStatus
    configJson: string
  }): void {
    const now = Date.now()
    this.profile.query(`
      INSERT INTO plugin_profile_generations (id, plugin_id, kind, version, digest, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.pluginId, input.kind, input.version, input.digest, input.status, input.configJson, now, now)
  }

  updateGenerationStatus(id: string, status: PluginGenerationStatus): void {
    this.profile.query("UPDATE plugin_profile_generations SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id)
  }

  listGenerations(pluginId: string, kind: PluginGenerationKind): PluginGenerationRow[] {
    const rows = this.profile.query(`
      SELECT id, plugin_id, kind, version, digest, status, config_json, created_at, updated_at
      FROM plugin_profile_generations WHERE plugin_id = ? AND kind = ?
      ORDER BY created_at, id
    `).all(pluginId, kind) as Array<{
      id: string
      plugin_id: string
      kind: PluginGenerationKind
      version: string
      digest: string
      status: PluginGenerationStatus
      config_json: string
      created_at: number
      updated_at: number
    }>
    return rows.map((row) => ({
      id: row.id,
      pluginId: row.plugin_id,
      kind: row.kind,
      version: row.version,
      digest: row.digest,
      status: row.status,
      configJson: row.config_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  latestGeneration(pluginId: string, kind: PluginGenerationKind, statuses: readonly PluginGenerationStatus[]): PluginGenerationRow | null {
    const placeholders = statuses.map(() => "?").join(",")
    const row = this.profile.query(`
      SELECT id, plugin_id, kind, version, digest, status, config_json, created_at, updated_at
      FROM plugin_profile_generations
      WHERE plugin_id = ? AND kind = ? AND status IN (${placeholders})
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(pluginId, kind, ...statuses) as {
      id: string
      plugin_id: string
      kind: PluginGenerationKind
      version: string
      digest: string
      status: PluginGenerationStatus
      config_json: string
      created_at: number
      updated_at: number
    } | null
    return row ? {
      id: row.id,
      pluginId: row.plugin_id,
      kind: row.kind,
      version: row.version,
      digest: row.digest,
      status: row.status,
      configJson: row.config_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null
  }

  // ── operations（幂等；重复 operationId 返回原结果） ───────────────────

  createOperation(input: { operationId: string; pluginId: string; method: string; requestHash: string }): PluginOperationRow {
    const now = Date.now()
    this.profile.query(`
      INSERT OR IGNORE INTO plugin_operations (operation_id, plugin_id, method, request_hash, status, result, error_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
    `).run(input.operationId, input.pluginId, input.method, input.requestHash, now, now)
    return this.getOperation(input.operationId)!
  }

  completeOperation(operationId: string, status: "completed" | "failed", result: unknown, errorCode: string | null): void {
    this.profile.query(`
      UPDATE plugin_operations SET status = ?, result = ?, error_code = ?, updated_at = ?
      WHERE operation_id = ?
    `).run(status, result === undefined ? null : JSON.stringify(result), errorCode, Date.now(), operationId)
  }

  getOperation(operationId: string): PluginOperationRow | null {
    const row = this.profile.query(`
      SELECT operation_id, plugin_id, method, request_hash, status, result, error_code, created_at, updated_at
      FROM plugin_operations WHERE operation_id = ?
    `).get(operationId) as {
      operation_id: string
      plugin_id: string
      method: string
      request_hash: string
      status: PluginOperationStatus
      result: string | null
      error_code: string | null
      created_at: number
      updated_at: number
    } | null
    return row ? {
      operationId: row.operation_id,
      pluginId: row.plugin_id,
      method: row.method,
      requestHash: row.request_hash,
      status: row.status,
      result: row.result,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null
  }

  // ── KV（按 plugin id + scope 隔离；CAS/version） ──────────────────────

  kvGet(pluginId: string, scope: PluginKvScope, workspaceKey: string, key: string): PluginKvEntry | null {
    const row = this.profile.query(`
      SELECT plugin_id, scope, workspace_key, key, value, version, updated_at
      FROM plugin_kv WHERE plugin_id = ? AND scope = ? AND workspace_key = ? AND key = ?
    `).get(pluginId, scope, workspaceKey, key) as {
      plugin_id: string
      scope: PluginKvScope
      workspace_key: string
      key: string
      value: string
      version: number
      updated_at: number
    } | null
    return row ? {
      pluginId: row.plugin_id,
      scope: row.scope,
      workspaceKey: row.workspace_key,
      key: row.key,
      value: row.value,
      version: row.version,
      updatedAt: row.updated_at,
    } : null
  }

  /** CAS 写入：expectedVersion 不符返回 false（不写入）。 */
  kvPut(pluginId: string, scope: PluginKvScope, workspaceKey: string, key: string, value: string, expectedVersion?: number): { ok: boolean; version: number } {
    const now = Date.now()
    const existing = this.profile.query(`
      SELECT version FROM plugin_kv WHERE plugin_id = ? AND scope = ? AND workspace_key = ? AND key = ?
    `).get(pluginId, scope, workspaceKey, key) as { version: number } | null
    if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
      return { ok: false, version: existing.version }
    }
    this.profile.query(`
      INSERT INTO plugin_kv (plugin_id, scope, workspace_key, key, value, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_id, scope, workspace_key, key) DO UPDATE SET
        value = excluded.value, version = plugin_kv.version + 1, updated_at = excluded.updated_at
    `).run(pluginId, scope, workspaceKey, key, value, 1, now)
    const updated = this.profile.query(`
      SELECT version FROM plugin_kv WHERE plugin_id = ? AND scope = ? AND workspace_key = ? AND key = ?
    `).get(pluginId, scope, workspaceKey, key) as { version: number }
    return { ok: true, version: updated.version }
  }

  kvDelete(pluginId: string, scope: PluginKvScope, workspaceKey: string, key: string): boolean {
    const result = this.profile.query(`
      DELETE FROM plugin_kv WHERE plugin_id = ? AND scope = ? AND workspace_key = ? AND key = ?
    `).run(pluginId, scope, workspaceKey, key)
    return result.changes > 0
  }

  listKv(pluginId: string): PluginKvEntry[] {
    const rows = this.profile.query(`
      SELECT plugin_id, scope, workspace_key, key, value, version, updated_at
      FROM plugin_kv WHERE plugin_id = ? ORDER BY scope, workspace_key, key
    `).all(pluginId) as Array<{
      plugin_id: string
      scope: PluginKvScope
      workspace_key: string
      key: string
      value: string
      version: number
      updated_at: number
    }>
    return rows.map((row) => ({
      pluginId: row.plugin_id,
      scope: row.scope,
      workspaceKey: row.workspace_key,
      key: row.key,
      value: row.value,
      version: row.version,
      updatedAt: row.updated_at,
    }))
  }
}
