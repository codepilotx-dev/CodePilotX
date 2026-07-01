import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { Text } from '../../ink.js'
import type { ProgressMessage } from '../../types/message.js'
import type { ToolProgressData, Tools } from '../../Tool.js'
import type { ThemeName } from '../../utils/theme.js'
import { MEMORY_TOOL_NAME } from './constants.js'

type Input = Partial<{
  command: string
  path: string
  new_path: string
}>

type Output = {
  command: string
  path: string
  content?: string
  contentTruncated?: boolean
  files?: Array<{
    path: string
    type?: string
    description?: string
  }>
  totalFiles?: number
}

export function userFacingName(input: Input | undefined): string {
  if (!input?.command) return MEMORY_TOOL_NAME
  switch (input.command) {
    case 'view':
      return 'Viewed memory'
    case 'create':
      return 'Created memory'
    case 'str_replace':
    case 'insert':
      return 'Updated memory'
    case 'delete':
      return 'Deleted memory'
    case 'rename':
      return 'Renamed memory'
    default:
      return 'Memory'
  }
}

export function getToolUseSummary(input: Input | undefined): string | null {
  if (!input?.path) return null
  return `${input.command} ${input.path}`
}

export function renderToolUseMessage(
  input: Input,
  _options: { verbose: boolean; theme: ThemeName; commands?: import('../../commands.js').Command[] },
): React.ReactNode {
  const label = userFacingName(input)
  const path = input.path ? ` ${input.path}` : ''
  return (
    <Text>
      {label}
      {path}
    </Text>
  )
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  _options: {
    style?: 'condensed'
    theme: ThemeName
    tools: Tools
    verbose: boolean
    isTranscriptMode?: boolean
    isBriefOnly?: boolean
    input?: unknown
  },
): React.ReactNode {
  const label = userFacingName({ command: output.command, path: output.path })
  return (
    <Text>
      {label}
      {output.contentTruncated ? ' (truncated)' : ''}
    </Text>
  )
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  _options: {
    progressMessagesForMessage: ProgressMessage<ToolProgressData>[]
    tools: Tools
    verbose: boolean
    isTranscriptMode?: boolean
  },
): React.ReactNode {
  const msg = typeof result === 'string' ? result : 'Memory tool error'
  return (
    <Text color="error">{msg}</Text>
  )
}
