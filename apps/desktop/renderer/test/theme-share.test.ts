import { describe, expect, test } from 'bun:test'

import {
  parseCodexThemeShare,
  serializeCodexThemeShare,
  type CodexThemeShareV2,
} from '../shared/themeShare.js'

const fixture: CodexThemeShareV2 = {
  version: 2,
  variant: 'light',
  codeThemeId: 'codex-light',
  theme: {
    accent: '#339cff',
    surface: '#ffffff',
    ink: '#1a1c1f',
    contrast: 45,
    opaqueWindows: false,
    fonts: { ui: null, code: 'JetBrains Mono' },
    semanticColors: {
      diffAdded: '#00a240',
      diffRemoved: '#e02e2a',
      skill: '#751ed9',
    },
  },
}

describe('Codex theme sharing', () => {
  test('round trips the codex-theme-v2 format', () => {
    const serialized = serializeCodexThemeShare(fixture)
    expect(serialized.startsWith('codex-theme-v2:')).toBeTrue()
    expect(parseCodexThemeShare(serialized, 'light')).toEqual(fixture)
  })

  test('rejects the wrong variant, unknown theme, colors and fields', () => {
    const serialized = serializeCodexThemeShare(fixture)
    expect(() => parseCodexThemeShare(serialized, 'dark')).toThrow()
    expect(() =>
      parseCodexThemeShare(
        serialized.replace('"codex-light"', '"andromeeda"'),
      ),
    ).toThrow()
    expect(() =>
      parseCodexThemeShare(serialized.replace('#339cff', '#fff')),
    ).toThrow()
    expect(() =>
      parseCodexThemeShare(serialized.replace('"variant":', '"extra":1,"variant":')),
    ).toThrow()
  })

  test('rejects missing prefix and malformed JSON', () => {
    expect(() => parseCodexThemeShare('{}')).toThrow()
    expect(() => parseCodexThemeShare('codex-theme-v2:{')).toThrow()
    expect(() => parseCodexThemeShare('codex-theme-v1:{}')).toThrow(
      'codex-theme-v1 主题已不再支持',
    )
  })
})
