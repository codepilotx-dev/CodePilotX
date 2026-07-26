import { describe, expect, test } from 'bun:test'
import type { DesktopProjectFolder } from '../shared/types.js'
import { createProjectFolderSavePlan } from '../src/features/projects/projectEditModel.js'

describe('project edit folder save plan', () => {
  test('adds replacements before switching primary and removing old folders', () => {
    const original = [
      folder('primary', 'C:\\repo', 'primary'),
      folder('docs', 'D:\\docs', 'secondary'),
    ]

    expect(createProjectFolderSavePlan(original, [
      {
        originalId: 'primary',
        path: 'C:\\repo',
        role: 'secondary',
      },
      {
        originalId: null,
        path: 'E:\\replacement',
        role: 'primary',
      },
    ])).toEqual({
      addPaths: ['E:\\replacement'],
      desiredPrimaryPath: 'E:\\replacement',
      removeFolderIds: ['docs'],
    })
  })

  test('rejects a draft without a primary folder', () => {
    expect(() => createProjectFolderSavePlan(
      [folder('primary', 'C:\\repo', 'primary')],
      [{ originalId: 'primary', path: 'C:\\repo', role: 'secondary' }],
    )).toThrow('项目必须保留一个主目录')
  })
})

function folder(
  id: string,
  path: string,
  role: DesktopProjectFolder['role'],
): DesktopProjectFolder {
  return {
    id,
    name: id,
    path,
    role,
    availability: 'available',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}
