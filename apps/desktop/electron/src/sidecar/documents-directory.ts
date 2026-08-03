import { join } from "node:path"

type DocumentsPathName = "documents" | "home"

export function resolveDocumentsDirectory(
  getPath: (name: DocumentsPathName) => string,
): string {
  try {
    return getPath("documents")
  } catch {
    return join(getPath("home"), "Documents")
  }
}
