import type { Database } from "bun:sqlite"

export const configureConnection = (database: Database) => {
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA busy_timeout = 5000")
}
