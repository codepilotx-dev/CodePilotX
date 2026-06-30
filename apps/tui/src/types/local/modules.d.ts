// Ambient declarations for modules not in this checkout

// Native modules
declare module 'cli-highlight' {
  const highlight: any
  export { highlight }
  export default highlight
  export function supportsLanguage(lang: string): boolean
}
declare module 'image-processor-napi' {
  const value: any
  export default value
}
declare module 'audio-capture-napi' {
  const value: any
  export default value
}
declare module 'plist' {
  const value: any
  export default value
}
declare module 'cacache' {
  const value: any
  export default value
}
declare module 'url-handler-napi' {
  const value: any
  export default value
}
declare module '@aws-sdk/credential-providers' {
  const value: any
  export default value
}

// Markdown imports
declare module '*.md' {
  const content: string
  export default content
}

// Truly missing source modules (not backed by real source files)
declare module '@codepilotx/tui/tasks/LocalWorkflowTask/LocalWorkflowTask.js' {}
declare module '@codepilotx/tui/tasks/MonitorMcpTask/MonitorMcpTask.js' {}
declare module '@codepilotx/tui/cli/up.js' {}
declare module '@codepilotx/tui/cli/rollback.js' {}
