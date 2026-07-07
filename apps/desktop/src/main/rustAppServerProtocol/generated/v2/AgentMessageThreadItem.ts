// GENERATED CODE! DO NOT MODIFY BY HAND!
// Adapted from codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts (agentMessage variant)
export type AgentMessageThreadItem = {
  type: 'agentMessage'
  id: string
  text: string
  phase: 'commentary' | 'final_answer'
}
