import { describe, expect, test } from 'bun:test'
import {
  resolveFileIconKind,
  type FileIconKind,
} from '../src/features/layout/fileIconKind.js'

describe('resolveFileIconKind', () => {
  test.each([
    ['C:\\workspace\\src\\Component.TSX', 'react'],
    ['/workspace/src/component.jsx', 'react'],
    ['C:\\workspace\\src\\index.MTS', 'typescript'],
    ['/workspace/src/index.cjs', 'javascript'],
    ['/workspace/docs/guide.MDX', 'markdown'],
    ['/workspace/styles/theme.SCSS', 'css'],
    ['/workspace/native/addon.CPP', 'cplusplus'],
    ['/workspace/scripts/setup.PS1', 'shell'],
    ['/workspace/data/app.SQLITE3', 'database'],
    ['/workspace/assets/logo.AVIF', 'image'],
    ['/workspace/reports/summary.XLSX', 'spreadsheet'],
    ['/workspace/archive/source.TAR.GZ', 'archive'],
  ] satisfies Array<[string, FileIconKind]>)(
    'classifies paths and extensions without case sensitivity: %s',
    (path, expected) => {
      expect(resolveFileIconKind(path)).toBe(expected)
    },
  )

  test.each([
    ['SKILL.md', 'skill'],
    ['C:\\repo\\PACKAGE.JSON', 'build'],
    ['/repo/tsconfig.app.json', 'build'],
    ['/repo/vite.config.ts', 'build'],
    ['/repo/Dockerfile.dev', 'build'],
    ['/repo/Makefile', 'build'],
    ['/repo/README.md', 'markdown'],
    ['/repo/LICENSE', 'document'],
  ] satisfies Array<[string, FileIconKind]>)(
    'gives special file names priority over their extension: %s',
    (path, expected) => {
      expect(resolveFileIconKind(path)).toBe(expected)
    },
  )

  test.each([
    ['/repo/.bashrc', 'shell'],
    ['/repo/.gitignore', 'build'],
    ['/repo/.env.local', 'build'],
    ['/repo/.customrc', 'file'],
  ] satisfies Array<[string, FileIconKind]>)(
    'handles dotfiles explicitly: %s',
    (path, expected) => {
      expect(resolveFileIconKind(path)).toBe(expected)
    },
  )

  test('distinguishes unknown extensions from files without extensions', () => {
    expect(resolveFileIconKind('/repo/source.unknown')).toBe('code')
    expect(resolveFileIconKind('/repo/binary')).toBe('file')
    expect(resolveFileIconKind('/repo/folder/')).toBe('file')
    expect(resolveFileIconKind(undefined)).toBe('file')
  })
})
