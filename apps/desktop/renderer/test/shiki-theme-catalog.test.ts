import { describe, expect, test } from 'bun:test'
import { SHIKI_THEME_SEEDS } from '../shared/shikiThemeSeeds.js'
import { DESKTOP_THEME_PRESETS } from '../shared/theme.js'

describe('Shiki theme catalog', () => {
  test('contains every theme bundled with the pinned Shiki version', () => {
    expect(SHIKI_THEME_SEEDS).toHaveLength(65)
    expect(new Set(SHIKI_THEME_SEEDS.map(seed => seed.id)).size).toBe(
      SHIKI_THEME_SEEDS.length,
    )

    for (const seed of SHIKI_THEME_SEEDS) {
      const matchingPresets = DESKTOP_THEME_PRESETS.filter(
        preset =>
          preset.config.variant === seed.variant &&
          preset.config.codeThemeId === seed.id,
      )
      expect(matchingPresets).toHaveLength(1)
    }
  })

  test('keeps an existing preset when it already owns a code theme', () => {
    const dracula = DESKTOP_THEME_PRESETS.find(
      preset =>
        preset.config.variant === 'dark' &&
        preset.config.codeThemeId === 'dracula',
    )

    expect(dracula?.id).toBe('dark-dracula')
    expect(dracula?.config.theme.surface).toBe('#282a36')
  })

  test('derives usable application colors for generated presets', () => {
    const generatedPresets = DESKTOP_THEME_PRESETS.filter(preset =>
      preset.id.includes('-shiki-'),
    )

    expect(generatedPresets.length).toBeGreaterThan(50)
    for (const preset of generatedPresets) {
      expect(preset.config.theme.surface).toMatch(/^#[\da-f]{6}$/)
      expect(preset.config.theme.ink).toMatch(/^#[\da-f]{6}$/)
      expect(preset.config.theme.accent).toMatch(/^#[\da-f]{6}$/)
      expect(preset.config.theme.semanticColors.diffAdded).toMatch(
        /^#[\da-f]{6}$/,
      )
      expect(preset.config.theme.semanticColors.diffRemoved).toMatch(
        /^#[\da-f]{6}$/,
      )
    }
  })
})
