import type { RpcParams } from '@codepilotx/agent-protocol'

import {
  environmentDomainClient,
  type EnvironmentDomainClient,
} from '../../../../services/desktop-client/environment-domain-client.js'

export type ConversationForkClient = Pick<
  EnvironmentDomainClient,
  | 'supportsThreadFork'
  | 'startThreadFork'
  | 'threadForkStatus'
  | 'pendingThreadFork'
  | 'retryThreadForkSetup'
  | 'continueThreadForkWithoutSetup'
  | 'abandonThreadFork'
>

export type ConversationForkPoint = {
  sourceThreadId: string
  lastTurnId: string
  sourceItemId: string
}

export type ConversationForkDestination = RpcParams<'thread/fork/start'>['destination']

export function conversationForkClient(): ConversationForkClient {
  return environmentDomainClient()
}
