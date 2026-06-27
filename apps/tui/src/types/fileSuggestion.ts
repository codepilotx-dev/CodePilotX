export interface FileSuggestion {
  path: string
  type: 'file' | 'directory'
  isDirectory: boolean
  displayPath: string
}
