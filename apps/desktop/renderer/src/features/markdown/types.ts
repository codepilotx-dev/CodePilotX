import type React from 'react'
import type { Token } from 'marked'

export type MarkdownMathToken = {
  type: 'math'
  raw: string
  text: string
  display: boolean
}

export type MarkdownDirectiveToken = {
  type: 'directive'
  raw: string
  name: string
  argument: string
  text: string
  tokens: MarkdownToken[]
}

export type MarkdownStreamingCodeToken = {
  type: 'streaming_code'
  raw: string
  lang: string
  text: string
}

export type MarkdownToken =
  | Token
  | MarkdownMathToken
  | MarkdownDirectiveToken
  | MarkdownStreamingCodeToken

export type MarkdownDirectiveRenderProps = {
  argument: string
  children: React.ReactNode
  name: string
  rawText: string
}

export type MarkdownDirectiveRenderer = (
  props: MarkdownDirectiveRenderProps,
) => React.ReactNode

export type MarkdownDirectiveRegistry = ReadonlyMap<
  string,
  MarkdownDirectiveRenderer
>

export type MarkdownExternalResourcePolicy = {
  allowExternalLinks?: boolean
  allowRemoteMedia?: boolean
}

export type MarkdownParseResult = {
  tokens: MarkdownToken[]
  stableText: string
  pendingText: string
}
