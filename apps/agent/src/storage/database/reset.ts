import { Database } from "bun:sqlite"
import {
  copyFileSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"
import { configureConnection } from "./connection"
import {
  HISTORY_SCHEMA,
  initializeSchema,
  PROFILE_SCHEMA,
} from "./schema-initializer"
import {
  DATA_EPOCH,
  PROFILE_APPLICATION_ID,
  PROFILE_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from "./schema"

export type StoragePaths = {
  legacyPath: string
  historyPath: string
  profilePath: string
}

const sidecars = (path: string) => [`${path}-wal`, `${path}-shm`] as const
const timestamp = () => new Date().toISOString().replaceAll(/[:.]/g, "-")

const retryLockedFile = (work: () => void) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      work()
      return
    } catch (cause) {
      const locked = cause instanceof Error && "code" in cause &&
        (cause.code === "EBUSY" || cause.code === "EPERM")
      if (!locked || attempt === 39) throw cause
      Bun.gc(true)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
}

const removeTemporaryDatabase = (path: string) => {
  for (const target of [path, ...sidecars(path)]) {
    retryLockedFile(() => rmSync(target, { force: true }))
  }
}

const databaseMeta = (path: string) => {
  const sqlite = new Database(path, { create: false, strict: true })
  try {
    return {
      applicationID: (sqlite.query("PRAGMA application_id").get() as { application_id: number }).application_id,
      userVersion: (sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    }
  } finally {
    sqlite.close()
  }
}

const checkpoint = (path: string) => {
  const sqlite = new Database(path, { create: false, strict: true })
  try {
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    sqlite.close()
  }
}

const tableNames = (schema: readonly string[]) => schema.flatMap((statement) => {
  const match = statement.match(/^CREATE TABLE\s+(?:"([^"]+)"|([^\s(]+))/)
  const name = match?.[1] ?? match?.[2]
  return name ? [name] : []
})

const columns = (sqlite: Database, schema: string, table: string) =>
  (sqlite.query(`PRAGMA ${schema}.table_info("${table.replaceAll('"', '""')}")`).all() as Array<{ name: string }>)
    .map(({ name }) => name)

const copyRecognizedTables = (
  sourcePath: string,
  target: Database,
  schema: readonly string[],
) => {
  target.exec("PRAGMA foreign_keys = OFF")
  const escapedSourcePath = sourcePath.replaceAll("'", "''")
  target.exec(`ATTACH DATABASE '${escapedSourcePath}' AS legacy`)
  try {
    const sourceTables = new Set(
      (target.query("SELECT name FROM legacy.sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map(({ name }) => name),
    )
    target.transaction(() => {
      for (const table of tableNames(schema)) {
        if (!sourceTables.has(table)) continue
        const targetColumns = new Set(columns(target, "main", table))
        const shared = columns(target, "legacy", table).filter((name) => targetColumns.has(name))
        if (shared.length === 0) continue
        const quoted = shared.map((name) => `"${name.replaceAll('"', '""')}"`).join(", ")
        const quotedTable = `"${table.replaceAll('"', '""')}"`
        const sourceCount = (target.query(`SELECT COUNT(*) AS count FROM legacy.${quotedTable}`).get() as { count: number }).count
        target.exec(`INSERT OR REPLACE INTO main.${quotedTable} (${quoted}) SELECT ${quoted} FROM legacy.${quotedTable}`)
        const targetCount = (target.query(`SELECT COUNT(*) AS count FROM main.${quotedTable}`).get() as { count: number }).count
        if (targetCount !== sourceCount) {
          throw new Error(`${table} 迁移行数不一致 (${sourceCount} → ${targetCount})`)
        }
      }
    })()
  } finally {
    target.exec("DETACH DATABASE legacy")
    target.exec("PRAGMA foreign_keys = ON")
  }
}

const validateDatabase = (sqlite: Database, kind: "history" | "profile") => {
  const integrity = sqlite.query("PRAGMA integrity_check").get() as { integrity_check: string }
  if (integrity.integrity_check !== "ok") throw new Error(`${kind} 数据库完整性校验失败`)
  const foreignKeyFailure = sqlite.query("PRAGMA foreign_key_check").get()
  if (foreignKeyFailure) throw new Error(`${kind} 数据库外键校验失败`)
  if (kind === "profile") {
    const settings = sqlite.query("SELECT key, value FROM app_settings").all() as Array<{ key: string; value: string }>
    for (const setting of settings) {
      try {
        JSON.parse(setting.value)
      } catch {
        throw new Error(`用户设置 ${setting.key} 不是有效 JSON`)
      }
    }
  }
}

const buildMigratingDatabase = (
  legacyPath: string,
  targetPath: string,
  kind: "history" | "profile",
) => {
  const temporaryPath = `${targetPath}.migrating`
  removeTemporaryDatabase(temporaryPath)
  const sqlite = new Database(temporaryPath, { create: true, strict: true })
  try {
    configureConnection(sqlite)
    initializeSchema(sqlite, kind)
    copyRecognizedTables(
      legacyPath,
      sqlite,
      kind === "history" ? HISTORY_SCHEMA : PROFILE_SCHEMA,
    )
    validateDatabase(sqlite, kind)
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } catch (cause) {
    sqlite.close()
    removeTemporaryDatabase(temporaryPath)
    throw cause
  }
  sqlite.close()
  return temporaryPath
}

const migrateOne = (
  legacyPath: string,
  targetPath: string,
  kind: "history" | "profile",
) => {
  if (existsSync(targetPath)) return
  const temporaryPath = buildMigratingDatabase(legacyPath, targetPath, kind)
  retryLockedFile(() => renameSync(temporaryPath, targetPath))
}

const backupLegacy = (paths: StoragePaths) => {
  const meta = databaseMeta(paths.legacyPath)
  const backup = join(
    dirname(paths.legacyPath),
    `${basename(paths.legacyPath)}.epoch-${meta.applicationID}.schema-${meta.userVersion}.${timestamp()}.bak`,
  )
  copyFileSync(paths.legacyPath, backup, COPYFILE_EXCL)
}

const COPYFILE_EXCL = 1

const prepareHistoryEpoch = (path: string) => {
  if (!existsSync(path)) return
  const meta = databaseMeta(path)
  if (meta.applicationID === DATA_EPOCH) return
  checkpoint(path)
  const backup = `${path}.epoch-${meta.applicationID}.schema-${meta.userVersion}.${timestamp()}.bak`
  copyFileSync(path, backup, COPYFILE_EXCL)
  removeTemporaryDatabase(path)
}

const upgradeMixedHistoryV17 = (paths: StoragePaths) => {
  if (!existsSync(paths.historyPath)) return
  const meta = databaseMeta(paths.historyPath)
  if (meta.applicationID !== DATA_EPOCH || meta.userVersion !== 17) return

  checkpoint(paths.historyPath)
  migrateOne(paths.historyPath, paths.profilePath, "profile")
  const temporaryPath = `${paths.historyPath}.migrating`
  removeTemporaryDatabase(temporaryPath)
  const sqlite = new Database(temporaryPath, { create: true, strict: true })
  try {
    configureConnection(sqlite)
    initializeSchema(sqlite, "history")
    copyRecognizedTables(paths.historyPath, sqlite, HISTORY_SCHEMA)
    validateDatabase(sqlite, "history")
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } catch (cause) {
    sqlite.close()
    removeTemporaryDatabase(temporaryPath)
    throw cause
  }
  sqlite.close()

  const backup = `${paths.historyPath}.schema-17.${timestamp()}.bak`
  copyFileSync(paths.historyPath, backup, COPYFILE_EXCL)
  removeTemporaryDatabase(paths.historyPath)
  retryLockedFile(() => renameSync(temporaryPath, paths.historyPath))
}

const validateExistingProfile = (path: string) => {
  if (!existsSync(path)) return
  const meta = databaseMeta(path)
  if (meta.applicationID !== PROFILE_APPLICATION_ID) {
    throw new Error("profile.sqlite 不属于当前应用，已保留原文件并拒绝覆盖")
  }
  if (meta.userVersion > PROFILE_SCHEMA_VERSION) {
    throw new Error(`profile.sqlite 来自更新版本 (${meta.userVersion})，拒绝降级`)
  }
}

/**
 * Prepares the two independent stores. A legacy monolithic database is copied
 * through validated temporary files; the source remains untouched and a
 * timestamped backup records successful completion.
 */
export const prepareStorage = (paths: StoragePaths) => {
  upgradeMixedHistoryV17(paths)
  prepareHistoryEpoch(paths.historyPath)
  validateExistingProfile(paths.profilePath)

  if (!existsSync(paths.legacyPath)) return
  checkpoint(paths.legacyPath)
  const hadBothTargets = existsSync(paths.historyPath) && existsSync(paths.profilePath)
  if (!existsSync(paths.historyPath) && !existsSync(paths.profilePath)) {
    const historyTemporary = `${paths.historyPath}.migrating`
    const profileTemporary = `${paths.profilePath}.migrating`
    try {
      buildMigratingDatabase(paths.legacyPath, paths.historyPath, "history")
      buildMigratingDatabase(paths.legacyPath, paths.profilePath, "profile")
      retryLockedFile(() => renameSync(profileTemporary, paths.profilePath))
      retryLockedFile(() => renameSync(historyTemporary, paths.historyPath))
    } catch (cause) {
      removeTemporaryDatabase(historyTemporary)
      removeTemporaryDatabase(profileTemporary)
      throw cause
    }
  } else {
    // Resume an interrupted publication without importing into an existing
    // target, which keeps the operation idempotent.
    migrateOne(paths.legacyPath, paths.historyPath, "history")
    migrateOne(paths.legacyPath, paths.profilePath, "profile")
  }
  if (!hadBothTargets) backupLegacy(paths)
}

/** Compatibility wrapper retained for callers outside the production bootstrap. */
export const prepareDatabase = (path: string) => prepareHistoryEpoch(path)
