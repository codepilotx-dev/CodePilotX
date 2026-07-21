import { EventManifest, type EventType } from "@codepilotx/agent-protocol"
import { Effect } from "effect"
import type { EventEnvelope } from "../domain"
import type { AgentDatabase } from "./Database"

export const isLiveEvent = (method: string): method is EventType =>
  method in EventManifest && EventManifest[method as EventType].durability === "live"

export const createLiveEvent = (
  threadId: string | null,
  turnId: string | null,
  method: string,
  params: unknown,
): EventEnvelope => ({
  // Live events deliberately have no durable sequence. The internal zero is
  // never exposed as a sequence by the SSE adapter.
  id: 0,
  threadId,
  turnId,
  method,
  params,
  createdAt: Date.now(),
})

/** Manifest-aware publishing boundary shared by transport and orchestration. */
export const publishAgentEvent = async (
  db: Pick<AgentDatabase, "insertEvent">,
  hub: { publish(event: EventEnvelope): Effect.Effect<unknown> },
  threadId: string | null,
  turnId: string | null,
  method: string,
  params: unknown,
) => {
  const event = isLiveEvent(method)
    ? createLiveEvent(threadId, turnId, method, params)
    : db.insertEvent(threadId, turnId, method, params)
  await Effect.runPromise(hub.publish(event))
  return event
}
