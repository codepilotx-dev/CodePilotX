export type KeybindingContextName = string

export interface ParsedKeystroke {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export interface ParsedBinding {
  keystrokes: ParsedKeystroke[]
  command: string
  context?: KeybindingContextName
  modal?: boolean
  description?: string
}

export interface KeybindingBlock {
  context?: KeybindingContextName
  bindings: ParsedBinding[]
}
