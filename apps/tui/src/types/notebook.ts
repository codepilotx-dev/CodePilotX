export interface NotebookCell {
  id: string
  code: string
  output?: string
  language: string
}

export interface Notebook {
  cells: NotebookCell[]
  metadata: Record<string, unknown>
}

export interface NotebookContent {
  cells: NotebookCell[]
  language: string
  metadata?: Record<string, unknown>
}
