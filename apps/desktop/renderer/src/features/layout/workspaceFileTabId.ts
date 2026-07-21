export function createWorkspaceFileTabId(
  workspacePath: string,
  relativePath: string,
): `file:${string}` {
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').toLowerCase()
  const normalizedFile = relativePath.replace(/\\/g, '/').toLowerCase()
  return `file:${encodeURIComponent(`${normalizedWorkspace}\u0000${normalizedFile}`)}`
}
