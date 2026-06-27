export interface AgentMcpServerInfo {
  name: string
  agent: string
}

export interface StdioServerInfo {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export interface ServerInfo {
  name: string
  enabled: boolean
  type: string
}

export type MCPViewState = string

export interface MCPToolInfo {
  name: string
  description: string
  serverName: string
}
