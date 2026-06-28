export type QuerySource = 'file' | 'stdin' | 'prompt' | 'sdk' | 'mcp' | 'cli' | 'plugin'

export const QUERY_SOURCE_FILE = 'file' as const
export const QUERY_SOURCE_STDIN = 'stdin' as const
export const QUERY_SOURCE_PROMPT = 'prompt' as const
export const QUERY_SOURCE_SDK = 'sdk' as const
export const QUERY_SOURCE_MCP = 'mcp' as const
export const QUERY_SOURCE_CLI = 'cli' as const
export const QUERY_SOURCE_PLUGIN = 'plugin' as const
