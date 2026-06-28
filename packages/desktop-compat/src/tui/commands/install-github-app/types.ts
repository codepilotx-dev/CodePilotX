export interface State {
  step: string
  loading: boolean
  error?: string
}

export interface Warning {
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface Workflow {
  id: string
  name: string
  state: State
}
