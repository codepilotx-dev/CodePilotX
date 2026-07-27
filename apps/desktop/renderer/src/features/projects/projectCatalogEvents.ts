type ProjectCatalogListener = () => void

const projectCatalogListeners = new Set<ProjectCatalogListener>()

export function notifyProjectCatalogChanged(): void {
  for (const listener of projectCatalogListeners) {
    listener()
  }
}

export function subscribeProjectCatalogChanges(
  listener: ProjectCatalogListener,
): () => void {
  projectCatalogListeners.add(listener)
  return () => projectCatalogListeners.delete(listener)
}
