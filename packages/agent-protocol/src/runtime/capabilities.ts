import { Schema } from "effect"

export const Capabilities = [
  "rpc.typed.v1",
  "events.replay.v1",
  "events.live.v1",
  "interactions.serverRequests.v1",
  "interaction.recovery.v1",
  "turn.admission.v1",
  "turn.steer.v1",
  "turn.resume.v1",
  "turn.queue.management.v1",
  "attachments.v1",
  "memory.v2",
  "workspace.editor.v1",
  "git.review.v1",
  "ai.review.v1",
  "github.oauth.v1",
  "github.pullRequests.v1",
  "context.compact.v1",
  "hooks.trust.v1",
  "subagents.v1",
  "sandbox.management.v1",
  "tooling.management.v1",
  "agent.shutdown.v1",
  "prompt.preview.sensitive.v1",
  "prompt.refresh.v1",
  "model.catalog.paged.v1",
  "pets.management.v1",
] as const

export const ProtocolCapabilitySchema = Schema.Literals(Capabilities)
export type ProtocolCapability = typeof ProtocolCapabilitySchema.Type
export type CapabilityRequirement = ProtocolCapability | null
