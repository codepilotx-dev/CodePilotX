import type { AgentDatabase } from "../database/AgentDatabase"

export type EventStore = Pick<AgentDatabase, "insertEvent" | "eventsAfter">

export const eventStore = (database: AgentDatabase): EventStore => database
