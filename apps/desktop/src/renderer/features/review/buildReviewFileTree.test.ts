import { describe, expect, test } from 'bun:test'
import type { DesktopReviewDiffFile } from '../../../shared/types.js'
import { buildReviewFileTree } from './buildReviewFileTree.js'

function fakeFile(
  path: string,
  additions = 1,
  deletions = 0,
): DesktopReviewDiffFile {
  return {
    path,
    status: 'M',
    additions,
    deletions,
    isUntracked: false,
    hunks: [],
  }
}

describe('buildReviewFileTree', () => {
  test('returns empty array when no files', () => {
    expect(buildReviewFileTree([])).toEqual([])
  })

  test('builds a flat single-root node for files at repo root', () => {
    const tree = buildReviewFileTree([
      fakeFile('a.ts'),
      fakeFile('b.tsx'),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.dirPath).toBe('')
    expect(tree[0]?.files.map(f => f.path)).toEqual(['a.ts', 'b.tsx'])
  })

  test('groups nested files under their directory path', () => {
    const tree = buildReviewFileTree([
      fakeFile('apps/desktop/src/main.ts', 5, 1),
      fakeFile('apps/desktop/src/renderer/app.tsx'),
      fakeFile('apps/desktop/test/main.test.ts'),
      fakeFile('README.md'),
    ])

    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root?.files.map(f => f.path)).toEqual(['README.md'])

    const appsNode = root?.children.find(node => node.dirPath === 'apps')
    expect(appsNode).toBeDefined()
    const desktop = appsNode?.children.find(node => node.dirPath === 'apps/desktop')
    expect(desktop).toBeDefined()
    expect(desktop?.children.map(c => c.dirPath)).toEqual([
      'apps/desktop/src',
      'apps/desktop/test',
    ])
    const srcNode = desktop?.children.find(c => c.dirPath === 'apps/desktop/src')
    expect(srcNode?.files.map(f => f.path)).toEqual(['main.ts'])
    expect(srcNode?.children.map(c => c.dirPath)).toEqual(['apps/desktop/src/renderer'])
    expect(srcNode?.children[0]?.files.map(f => f.path)).toEqual(['app.tsx'])
  })

  test('keeps duplicate basenames under different directories intact', () => {
    const tree = buildReviewFileTree([
      fakeFile('src/utils/index.ts'),
      fakeFile('test/utils/index.ts'),
    ])
    expect(tree).toHaveLength(2)
    const labels = tree.map(node => node.dirLabel).sort()
    expect(labels).toEqual(['src', 'test'])
    const src = tree.find(node => node.dirLabel === 'src')
    const test = tree.find(node => node.dirLabel === 'test')
    expect(src?.children[0]?.files[0]?.path).toBe('index.ts')
    expect(test?.children[0]?.files[0]?.path).toBe('index.ts')
  })

  test('sorts directory children alphabetically and files alphabetically', () => {
    const tree = buildReviewFileTree([
      fakeFile('zebra.ts'),
      fakeFile('apple.ts'),
      fakeFile('src/z-file.ts'),
      fakeFile('src/a-file.ts'),
    ])
    const root = tree[0]
    expect(root?.files.map(f => f.path)).toEqual(['apple.ts', 'zebra.ts'])
    expect(root?.children.map(c => c.dirLabel)).toEqual(['src'])
    expect(root?.children[0]?.files.map(f => f.path)).toEqual([
      'a-file.ts',
      'z-file.ts',
    ])
  })
})