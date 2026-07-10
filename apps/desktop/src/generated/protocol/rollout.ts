export type CodePilotXRolloutLine = {
  timestamp: string
  type: CodePilotXRolloutItemType
  payload: Record<string, unknown>
}

export type CodePilotXRolloutItemType =
  | 'session_meta'
  | 'turn_context'
  | 'response_item'
  | 'event_msg'
  | 'compacted'

export type CodePilotXRolloutItem<
  TPayload extends object = Record<string, unknown>,
> = {
  type: CodePilotXRolloutItemType
  payload: TPayload
}

export type CodePilotXSessionMetaPayload = {
  id: string
  timestamp: string
  cwd: string
  originator: string
  cli_version: string
}
