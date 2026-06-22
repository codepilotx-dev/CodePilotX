import type { DesktopFilePreview } from '../shared/types.js'

export async function readOptionalWorkspaceFile(
  readFile: (
    workspacePath: string,
    filePath: string,
  ) => Promise<DesktopFilePreview>,
  workspacePath: string,
  filePath: string,
): Promise<DesktopFilePreview | null> {
  try {
    return await readFile(workspacePath, filePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
