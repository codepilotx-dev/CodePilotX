declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  VERSION_CHANGELOG: string
}

declare module 'bun:bundle' {
  export function feature(name: string): boolean
}

declare module '*.node' {
  const value: any
  export default value
}

declare module 'audio-capture.node' {
  const value: any
  export default value
}

declare module 'color-diff-napi' {
  const value: any
  export default value
}

declare module 'modifiers-napi' {
  const value: any
  export default value
}

declare module '@ant/claude-for-chrome-mcp' {
  export const BROWSER_TOOLS: any[]
  export function createClaudeForChromeMcpServer(...args: any[]): any
  export type ClaudeForChromeContext = any
  export type Logger = any
  export type PermissionMode = any
  export const server: any
  export default server
}

declare module '@ant/computer-use-input' {
  const value: any
  export default value
}

declare module '@ant/computer-use-swift' {
  const value: any
  export default value
}

declare module '@ant/computer-use-mcp' {
  export const API_RESIZE_PARAMS: any
  export const DEFAULT_GRANT_FLAGS: any
  export function bindSessionContext(...args: any[]): any
  export function buildComputerUseTools(...args: any[]): any[]
  export function createComputerUseMcpServer(...args: any[]): any
  export function targetImageSize(...args: any[]): any
  export type ComputerUseSessionContext = any
  export type CuCallToolResult = any
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
  export type ScreenshotDims = any
  export const server: any
  export default server
}

declare module '@ant/computer-use-mcp/types' {
  export type AppInfo = any
  export type AppList = any
  export type ComputerUseEvent = any
  export type ComputerUseResult = any
  export type CoordinateMode = any
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
  export type CuSubGates = any
  export const DEFAULT_GRANT_FLAGS: any
}

declare module '@ant/computer-use-mcp/sentinelApps' {
  export const SENTINEL_APPS: any[]
  export function getSentinelCategory(...args: any[]): any
}
