import type { EventPayload, ServerRequestResponse } from "@codepilotx/agent-protocol"

export const interactionResolvedPayload = (
  result: ServerRequestResponse,
  resolvedAt: number,
): EventPayload<"interaction/resolved"> => ({ result, resolvedAt })

export const approvalCancelledPayload = (
  interactionId: string,
  reason: string,
  cancelledAt: number,
): EventPayload<"approval/cancelled"> => ({ interactionId, reason, cancelledAt })
