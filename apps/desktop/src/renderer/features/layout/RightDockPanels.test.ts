import { describe, expect, test } from 'bun:test'
import {
  buildAppendText,
  buildFileSelectionPrompt,
  getSendableFilePath,
  shouldShowSelectionSendAction,
} from './RightDockPanels.js'

describe('right dock file send helpers', () => {
  test('buildFileSelectionPrompt includes file path and selected text fence', () => {
    expect(
      buildFileSelectionPrompt({
        path: 'apps/desktop/src/renderer/App.tsx',
        selectedText: 'export function App() {}',
      }),
    ).toBe(
      [
        '文件选区：',
        '- 文件：apps/desktop/src/renderer/App.tsx',
        '',
        '```tsx',
        'export function App() {}',
        '```',
      ].join('\n'),
    )
  })

  test('shouldShowSelectionSendAction requires non-empty selected text', () => {
    expect(shouldShowSelectionSendAction('  selected text  ')).toBe(true)
    expect(shouldShowSelectionSendAction('   ')).toBe(false)
  })

  test('getSendableFilePath only resolves files inside an opened workspace', () => {
    expect(
      getSendableFilePath({
        workspacePath: 'D:/VueProject/ClaudeCode',
        file: {
          name: 'App.tsx',
          path: 'apps/desktop/src/renderer/App.tsx',
          type: 'file',
          depth: 4,
        },
      }),
    ).toBe('D:/VueProject/ClaudeCode/apps/desktop/src/renderer/App.tsx')

    expect(
      getSendableFilePath({
        workspacePath: 'D:/VueProject/ClaudeCode',
        file: {
          name: 'apps',
          path: 'apps',
          type: 'directory',
          depth: 0,
        },
      }),
    ).toBeNull()
  })

  test('buildAppendText appends with newline separator when prev is non-empty', () => {
    expect(buildAppendText('hello', 'world')).toBe('hello\n\nworld')
  })

  test('buildAppendText appends directly when prev is empty', () => {
    expect(buildAppendText('', 'hello')).toBe('hello')
  })

  test('buildAppendText returns prev unchanged when text is only whitespace', () => {
    expect(buildAppendText('hello', '   ')).toBe('hello')
  })

  test('buildAppendText trims the appended text', () => {
    expect(buildAppendText('hello', '  world  ')).toBe('hello\n\nworld')
  })

  test('buildAppendText handles prev whitespace but empty text', () => {
    expect(buildAppendText('  ', 'world')).toBe('world')
  })
})
