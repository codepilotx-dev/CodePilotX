import type { AgentDatabase } from "./AgentDatabase"

export type TransactionalDatabase = Pick<
  AgentDatabase,
  "transaction" | "onTransactionCommit" | "onTransactionRollback"
>
