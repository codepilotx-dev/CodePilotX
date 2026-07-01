import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { getCodePilotXConfigHomeDir } from '../storage.js'
import { runMigrations } from './migrations.js'

/**
 * SQLite database connection manager.
 *
 * Singleton — one connection per Node.js process. Uses WAL mode for
 * concurrent-reader / single-writer access and a 5-second busy timeout
 * so transient contention (Desktop + TUI writing simultaneously) resolves
 * without throwing.
 */
export class SessionDatabase {
  private static _instance: SessionDatabase | null = null
  private _db: Database.Database | null = null

  /** Path to the SQLite database file. */
  readonly dbPath: string

  private constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Get (or create) the singleton database connection. */
  static getInstance(dbPath?: string): SessionDatabase {
    if (!SessionDatabase._instance) {
      const resolvedPath =
        dbPath ?? join(getCodePilotXConfigHomeDir(), 'state.db')
      SessionDatabase._instance = new SessionDatabase(resolvedPath)
    }
    return SessionDatabase._instance
  }

  /** Reset the singleton (useful for testing or config changes). */
  static resetInstance(): void {
    if (SessionDatabase._instance) {
      SessionDatabase._instance.close()
      SessionDatabase._instance = null
    }
  }

  /** Lazily open and migrate the database. */
  open(): void {
    if (this._db) return

    // Ensure the parent directory exists
    const dir = dirname(this.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this._db = new Database(this.dbPath)

    // WAL mode for concurrent-read concurrency
    this._db.pragma('journal_mode = WAL')
    // Normal sync — balances safety and speed
    this._db.pragma('synchronous = NORMAL')
    // 5-second busy timeout resolves transient lock contention
    this._db.pragma('busy_timeout = 5000')
    // Foreign keys
    this._db.pragma('foreign_keys = ON')

    // Run migrations
    runMigrations(this._db)
  }

  /** The underlying better-sqlite3 Database handle. Opens if needed. */
  get db(): Database.Database {
    this.open()
    return this._db!
  }

  /** Close the database connection. */
  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
  }

  /** Returns true if the database has been opened. */
  get isOpen(): boolean {
    return this._db !== null
  }
}
