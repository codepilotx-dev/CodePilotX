import { describe, expect, test } from 'bun:test'
import type { ThemeRegistration } from 'shiki'

import {
  deriveChromeThemeSeed,
  loadChromeThemeSeed,
  mergeChromeThemeSeed,
} from '../src/features/theme/codeThemeSeed.js'
import { DEFAULT_DARK_CHROME_THEME } from '../shared/theme.js'
import { CODEX_HIGHLIGHT_THEMES } from '../shared/codexThemes/manifest.js'

describe('code theme Chrome seed', () => {
  test('derives Codex defaults from VS Code color roles', async () => {
    expect(await loadChromeThemeSeed('codex-light', 'light')).toMatchObject({
      surface: '#ffffff',
      ink: '#0d0d0d',
      accent: '#0169cc',
      semanticColors: {
        diffAdded: '#00a240',
        diffRemoved: '#e02e2a',
        skill: '#751ed9',
      },
    })
  })

  test('uses token hue fallbacks and a module chromeTheme override', () => {
    const registration = {
      name: 'fixture',
      type: 'dark',
      colors: { 'editor.background': '#111111' },
      tokenColors: [
        { settings: { foreground: '#45cc67' } },
        { settings: { foreground: '#f05252' } },
        { settings: { foreground: '#a866ee' } },
      ],
      chromeTheme: {
        accent: '#abcdef',
        contrast: 77,
        fonts: { ui: 'Inter', code: null },
      },
    } as unknown as ThemeRegistration
    expect(deriveChromeThemeSeed(registration, 'dark')).toMatchObject({
      accent: '#abcdef',
      contrast: 77,
      fonts: { ui: 'Inter', code: null },
      semanticColors: {
        diffAdded: '#45cc67',
        diffRemoved: '#f05252',
        skill: '#a866ee',
      },
    })
  })

  test('all catalog themes produce complete six-digit seeds', async () => {
    for (const metadata of CODEX_HIGHLIGHT_THEMES) {
      const seed = await loadChromeThemeSeed(metadata.slug, metadata.variant)
      for (const color of [
        seed.surface,
        seed.ink,
        seed.accent,
        ...Object.values(seed.semanticColors),
      ]) {
        expect(color).toMatch(/^#[\da-f]{6}$/)
      }
    }
  })

  test('merges a code theme seed without resetting user-only Chrome fields', async () => {
    const seed = await loadChromeThemeSeed('dracula', 'dark')
    const merged = mergeChromeThemeSeed(
      {
        ...DEFAULT_DARK_CHROME_THEME,
        contrast: 73,
        fonts: { ui: 'Inter', code: 'Cascadia Code' },
        opaqueWindows: true,
      },
      seed,
    )

    expect(merged).toMatchObject({
      contrast: 73,
      fonts: { ui: 'Inter', code: 'Cascadia Code' },
      opaqueWindows: true,
      surface: '#282a36',
      ink: '#f8f8f2',
      accent: '#ff79c6',
    })
  })
})
