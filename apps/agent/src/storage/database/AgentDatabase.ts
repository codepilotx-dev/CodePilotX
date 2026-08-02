import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { RepositoryDatabase } from "../repositories/RepositoryDatabase"
import { credentialRepositoryDatabase } from "../repositories/credential-repository"
import { executionRepository } from "../repositories/execution-repository"
import { interactionRepository } from "../repositories/interaction-repository"
import { projectRepository } from "../repositories/project-repository"
import { reviewRepository } from "../repositories/review-repository"
import { subagentRepositoryDatabase } from "../repositories/subagent-repository"
import { threadRepository } from "../repositories/thread-repository"
import { TurnPatchRepository } from "../repositories/turn-patch-repository"
import { workspaceRepository } from "../repositories/workspace-repository"
import { recoverInterruptedRuns } from "../recovery/interrupted-run-recovery"
import { configureConnection } from "./connection"
import { backfillProjectThreadWorkspaces, initializeSchema } from "./schema-initializer"
import { HISTORY_APPLICATION_ID } from "./schema"
import { prepareStorage, type StoragePaths } from "./reset"

export { DATA_EPOCH, HISTORY_APPLICATION_ID, SCHEMA_VERSION } from "./schema"
export * from "../repositories/RepositoryDatabase"

export type AgentDatabasePaths = {
  historyPath: string
  profilePath: string
  legacyPath?: string
}

export class AgentDatabase extends RepositoryDatabase {
  constructor(input: string | AgentDatabasePaths) {
    const paths: StoragePaths = typeof input === "string"
      ? {
          historyPath: input,
          profilePath: `${input}.profile`,
          legacyPath: `${input}.legacy`,
        }
      : {
          historyPath: input.historyPath,
          profilePath: input.profilePath,
          legacyPath: input.legacyPath ?? `${input.historyPath}.legacy`,
        }
    mkdirSync(dirname(paths.historyPath), { recursive: true })
    mkdirSync(dirname(paths.profilePath), { recursive: true })
    prepareStorage(paths)
    const sqlite = new Database(paths.historyPath, { create: true, strict: true })
    const profileSqlite = new Database(paths.profilePath, { create: true, strict: true })
    configureConnection(sqlite)
    configureConnection(profileSqlite)
    try {
      initializeSchema(profileSqlite, "profile")
      initializeSchema(sqlite, "history")
      backfillProjectThreadWorkspaces(sqlite, profileSqlite)
    } catch (cause) {
      sqlite.close()
      profileSqlite.close()
      throw cause
    }
    super(sqlite, profileSqlite)
    this.repositories = {
      threads: threadRepository(this),
      executions: executionRepository(this),
      interactions: interactionRepository(this),
      subagents: subagentRepositoryDatabase(this),
      projects: projectRepository(this),
      workspaces: workspaceRepository(this),
      reviews: reviewRepository(this),
      credentials: credentialRepositoryDatabase(this),
      turnPatches: new TurnPatchRepository(this),
    }
    sqlite.exec(`PRAGMA application_id = ${HISTORY_APPLICATION_ID}`)
    recoverInterruptedRuns(this)
  }

  readonly repositories

  close() {
    this.sqlite.close()
    if (this.profileSqlite !== this.sqlite) this.profileSqlite.close()
  }
}
