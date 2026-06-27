export interface Tip {
  id: string
  title: string
  message: string
  category?: string
  priority?: number
}

export interface TipContext {
  cwd: string
  isGit: boolean
  model?: string
  hasConfig?: boolean
}
