import type { DesktopReviewDiffFile } from '../../../shared/types.js'

export type ReviewFileTreeNode = {
  dirPath: string
  dirLabel: string
  children: ReviewFileTreeNode[]
  files: DesktopReviewDiffFile[]
}

const ROOT_DIR = ''

export function buildReviewFileTree(
  files: DesktopReviewDiffFile[],
): ReviewFileTreeNode[] {
  if (files.length === 0) return []

  const root = createNode(ROOT_DIR, '(root)')
  for (const file of files) {
    const segments = file.path.split('/')
    segments.pop() // remove filename, leaving only directory segments
    let current = root
    for (const segment of segments) {
      const childPath = current.dirPath
        ? `${current.dirPath}/${segment}`
        : segment
      let child = current.children.find(node => node.dirPath === childPath)
      if (!child) {
        child = createNode(childPath, segment)
        current.children.push(child)
      }
      current = child
    }
    current.files.push(file)
  }

  sortNode(root)
  return collapseSingleChildRoots(root)
}

function createNode(dirPath: string, dirLabel: string): ReviewFileTreeNode {
  return { dirPath, dirLabel, children: [], files: [] }
}

function sortNode(node: ReviewFileTreeNode): void {
  node.children.sort((a, b) => a.dirLabel.localeCompare(b.dirLabel))
  node.files.sort((a, b) => a.path.localeCompare(b.path))
  for (const child of node.children) sortNode(child)
}

function collapseSingleChildRoots(root: ReviewFileTreeNode): ReviewFileTreeNode[] {
  if (root.dirPath !== ROOT_DIR) return [root]
  if (root.files.length > 0) return [root]
  if (root.children.length === 0) return [root]
  return root.children.map(child => rebase(child, child.dirLabel, child.dirLabel))
}

function rebase(
  node: ReviewFileTreeNode,
  newDirPath: string,
  newDirLabel: string,
): ReviewFileTreeNode {
  const rebased: ReviewFileTreeNode = {
    dirPath: newDirPath,
    dirLabel: newDirLabel,
    children: node.children.map(child =>
      rebase(
        child,
        node.dirPath ? `${node.dirPath}/${child.dirLabel}` : child.dirLabel,
        child.dirLabel,
      ),
    ),
    files: node.files,
  }
  return rebased
}