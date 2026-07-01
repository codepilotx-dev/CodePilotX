export type CodexRolloutLine = {
  timestamp: string
  type: CodexRolloutItemType
  payload: Record<string, unknown>
}

export type CodexRolloutItemType =
  | 'session_meta'
  | 'turn_context'
  | 'response_item'
  | 'event_msg'
  | 'compacted'

export type CodexRolloutItem<
  TPayload extends object = Record<string, unknown>,
> = {
  type: CodexRolloutItemType
  payload: TPayload
}

export type CodexSessionMetaPayload = {
  id: string
  timestamp: string
  cwd: string
  originator: string
  cli_version: string
}
