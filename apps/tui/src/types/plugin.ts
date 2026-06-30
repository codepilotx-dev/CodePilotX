export interface PluginInfo {
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
}

export interface PluginSource {
  url: string
  type: 'marketplace' | 'git' | 'local'
}

export interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  main: string
  hooks?: string[]
  commands?: string[]
  skills?: string[]
}

export interface LoadedPlugin {
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  path: string
  manifest: PluginManifest
}

export interface PluginError {
  name: string
  message: string
  plugin: string
}

export function getPluginErrorMessage(error: PluginError): string {
  return `${error.plugin}: ${error.message}`
}
