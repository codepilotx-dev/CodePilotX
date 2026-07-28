import type { ReviewSource } from "@codepilotx/agent-protocol"

export const reviewSourceKey = (source: ReviewSource) => JSON.stringify(source)
