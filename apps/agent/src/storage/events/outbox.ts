import type { AgentDatabase } from "../database/AgentDatabase"

export type TransactionalOutbox = Pick<
  AgentDatabase,
  "insertEvent" | "transaction" | "onTransactionCommit" | "onTransactionRollback"
>

export const transactionalOutbox = (database: AgentDatabase): TransactionalOutbox => database
