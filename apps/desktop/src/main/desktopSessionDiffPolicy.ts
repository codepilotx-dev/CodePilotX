export function shouldEmitWorkspaceDiffEvent(params: {
  beforePatch?: string | null
  afterPatch: string
  standalone: boolean
}): boolean {
  if (params.standalone) {
    return false
  }
  if (params.afterPatch === 'No file changes.') {
    return false
  }
  if (params.beforePatch !== undefined && params.beforePatch !== null) {
    return params.beforePatch !== params.afterPatch
  }
  return true
}
