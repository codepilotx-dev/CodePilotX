import type { DesktopProjectFolder } from '../../../shared/types.js'

export type ProjectFolderSaveDraft = Pick<
  DesktopProjectFolder,
  'path' | 'role'
> & {
  originalId: string | null
}

export type ProjectFolderSavePlan = {
  addPaths: string[]
  desiredPrimaryPath: string
  removeFolderIds: string[]
}

export function createProjectFolderSavePlan(
  originalFolders: readonly DesktopProjectFolder[],
  draftFolders: readonly ProjectFolderSaveDraft[],
): ProjectFolderSavePlan {
  const primary = draftFolders.find(folder => folder.role === 'primary')
  if (!primary) throw new Error('项目必须保留一个主目录。')
  const retainedOriginalIds = new Set(
    draftFolders.flatMap(folder =>
      folder.originalId ? [folder.originalId] : [],
    ),
  )
  return {
    addPaths: draftFolders.flatMap(folder =>
      folder.originalId ? [] : [folder.path],
    ),
    desiredPrimaryPath: primary.path,
    removeFolderIds: originalFolders.flatMap(folder =>
      retainedOriginalIds.has(folder.id) ? [] : [folder.id],
    ),
  }
}
