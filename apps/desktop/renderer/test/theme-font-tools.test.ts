import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  normalizeDesktopThemeSettings,
} from '../shared/theme.js'
import { mergeChromeThemeSeed } from '../src/features/theme/codeThemeSeed.js'
import {
  escapeCssString,
  fontFamilyWithFace,
  loadThemeFontFace,
  themeFontFaceAlias,
  themeFontFaceSource,
} from '../src/features/theme/themeFontFaces.js'
import {
  isMonospaceFamily,
  type FontMeasureContext,
} from '../src/features/theme/themeSystemFonts.js'
import {
  DEFAULT_FACE_VALUE,
  SYSTEM_DEFAULT_FAMILY_VALUE,
  buildFamilyOptions,
  buildStyleOptions,
  fontPatchForSelection,
  styleLabel,
} from '../src/features/settings/themeFontPickerModel.js'
import { deriveThemeVariables } from '../src/features/theme/themeVariables.js'
import type { DesktopSystemFontFace } from '../shared/types.js'

const SANS_FACES: readonly DesktopSystemFontFace[] = [
  {
    family: 'Inter',
    fullName: 'Inter Regular',
    postscriptName: 'Inter-Regular',
    style: 'Regular',
  },
  {
    family: 'Inter',
    fullName: 'Inter Bold',
    postscriptName: 'Inter-Bold',
    style: 'Bold',
  },
  {
    family: 'Inter',
    fullName: 'Inter Italic',
    postscriptName: 'Inter-Italic',
    style: 'Italic',
  },
  {
    family: 'PrettySans',
    fullName: 'PrettySans Regular',
    postscriptName: 'PrettySans-Regular',
    style: 'Regular',
  },
]

const MONO_FACES: readonly DesktopSystemFontFace[] = [
  {
    family: 'CodeMono',
    fullName: 'CodeMono Regular',
    postscriptName: 'CodeMono-Regular',
    style: 'Regular',
  },
  {
    family: 'CodeMono',
    fullName: 'CodeMono Bold',
    postscriptName: 'CodeMono-Bold',
    style: 'Bold',
  },
]

const ALL_FACES = [...SANS_FACES, ...MONO_FACES]

function monoContext(family: string): FontMeasureContext | null {
  return {
    font: family,
    measureText: text => ({ width: text.length * 8 }),
  }
}

function proportionalContext(family: string): FontMeasureContext | null {
  return {
    font: family,
    measureText: text => ({
      width: text.startsWith('m') ? text.length * 12 : text.length * 6,
    }),
  }
}

describe('theme font loading tool', () => {
  test('escapes CSS string special characters in alias sources', () => {
    expect(escapeCssString('plain')).toBe('plain')
    expect(escapeCssString('a"b\\c')).toBe('a\\"b\\\\c')
  })

  test('builds the unique alias and the local() source in reference order', () => {
    const face = {
      family: 'JetBrains Mono',
      fullName: 'JetBrains Mono Regular',
      postscriptName: 'JetBrainsMono-Regular',
    }
    expect(themeFontFaceAlias(face)).toBe(
      'CodePilotX selected JetBrainsMono-Regular',
    )
    expect(themeFontFaceSource(face)).toBe(
      'local("JetBrainsMono-Regular"), local("JetBrains Mono Regular")',
    )
  })

  test('places the alias before the original family and falls back without a face', () => {
    const face = {
      family: 'JetBrains Mono',
      fullName: 'JetBrains Mono Regular',
      postscriptName: 'JetBrainsMono-Regular',
    }
    expect(fontFamilyWithFace(face, 'Inter, sans-serif')).toBe(
      '"CodePilotX selected JetBrainsMono-Regular", Inter, sans-serif',
    )
    expect(fontFamilyWithFace(null, 'Inter, sans-serif')).toBe(
      'Inter, sans-serif',
    )
    expect(fontFamilyWithFace(undefined, 'Inter, sans-serif')).toBe(
      'Inter, sans-serif',
    )
  })

  test('failed face loads resolve to null and never affect startup', async () => {
    // Bun tests have no DOM/FontFace: the loader must degrade to null.
    expect(await loadThemeFontFace({
      family: 'Inter',
      fullName: 'Inter Regular',
      postscriptName: 'Inter-Regular',
    })).toBeNull()
  })

  test('deriveThemeVariables composes face aliases into font variables', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        fonts: {
          ui: 'Inter',
          uiFace: {
            family: 'Inter',
            fullName: 'Inter Bold',
            postscriptName: 'Inter-Bold',
          },
          code: 'CodeMono',
          codeFace: {
            family: 'CodeMono',
            fullName: 'CodeMono Regular',
            postscriptName: 'CodeMono-Regular',
          },
        },
      },
    })

    expect(variables['--cpx-sys-font-family-sans']).toBe(
      '"CodePilotX selected Inter-Bold", Inter',
    )
    expect(variables['--cpx-sys-font-family-mono']).toBe(
      '"CodePilotX selected CodeMono-Regular", CodeMono',
    )
  })

  test('mergeChromeThemeSeed clears stale faces when a family changes', () => {
    const current = {
      ...DEFAULT_DARK_THEME.theme,
      fonts: {
        ui: 'JetBrains Mono',
        uiFace: {
          family: 'JetBrains Mono',
          fullName: 'JetBrains Mono Bold',
          postscriptName: 'JetBrainsMono-Bold',
        },
        code: null,
        codeFace: null,
      },
    }
    const merged = mergeChromeThemeSeed(current, {
      surface: current.surface,
      ink: current.ink,
      accent: current.accent,
      fonts: { ui: 'Inter', code: null },
    })

    expect(merged.fonts.ui).toBe('Inter')
    expect(merged.fonts.uiFace).toBeNull()
    expect(merged.fonts.codeFace).toBeNull()
  })

  test('mergeChromeThemeSeed keeps faces when the family is unchanged', () => {
    const uiFace = {
      family: 'Inter',
      fullName: 'Inter Bold',
      postscriptName: 'Inter-Bold',
    }
    const current = {
      ...DEFAULT_DARK_THEME.theme,
      fonts: {
        ui: 'Inter',
        uiFace,
        code: null,
        codeFace: null,
      },
    }
    const merged = mergeChromeThemeSeed(current, {
      surface: current.surface,
      ink: current.ink,
      accent: current.accent,
      fonts: { ui: 'Inter', code: 'CodeMono' },
    })

    expect(merged.fonts.uiFace).toEqual(uiFace)
    expect(merged.fonts.codeFace).toBeNull()
  })
})

describe('system font enumeration helpers', () => {
  test('detects monospace families through canvas glyph widths', () => {
    expect(isMonospaceFamily('CodeMono', monoContext)).toBe(true)
    expect(isMonospaceFamily('PrettySans', proportionalContext)).toBe(false)
  })

  test('treats missing measurement contexts as unverifiable and shows all', () => {
    expect(isMonospaceFamily('Anything', () => null)).toBe(true)
  })
})

describe('theme font picker model', () => {
  test('style labels map the common face styles', () => {
    expect(styleLabel('Regular')).toBe('常规')
    expect(styleLabel('normal')).toBe('常规')
    expect(styleLabel('Bold')).toBe('粗体')
    expect(styleLabel('Italic')).toBe('斜体')
    expect(styleLabel('Bold Italic')).toBe('粗斜体')
    expect(styleLabel('Medium')).toBe('中等')
    expect(styleLabel('Semi Bold')).toBe('半粗体')
    expect(styleLabel('Condensed')).toBe('Condensed')
  })

  test('family options start with system default and keep the current family', () => {
    const options = buildFamilyOptions({
      faces: ALL_FACES,
      kind: 'ui',
      currentFamily: null,
      isMonospace: family => family === 'CodeMono',
    })
    expect(options[0]).toEqual({
      value: SYSTEM_DEFAULT_FAMILY_VALUE,
      label: '系统默认',
    })
    expect(options.map(option => option.label)).toEqual([
      '系统默认',
      'CodeMono',
      'Inter',
      'PrettySans',
    ])

    const custom = buildFamilyOptions({
      faces: ALL_FACES,
      kind: 'ui',
      currentFamily: 'Custom List, sans-serif',
      isMonospace: family => family === 'CodeMono',
    })
    expect(custom.map(option => option.label)).toEqual([
      '系统默认',
      'CodeMono',
      'Inter',
      'PrettySans',
      'Custom List, sans-serif',
    ])
  })

  test('code font families are filtered to monospace ones but keep custom values', () => {
    const options = buildFamilyOptions({
      faces: ALL_FACES,
      kind: 'code',
      currentFamily: 'PrettySans',
      isMonospace: family => family === 'CodeMono',
    })
    expect(options.map(option => option.label)).toEqual([
      '系统默认',
      'CodeMono',
      'PrettySans',
    ])
  })

  test('style options use the regular face as the default option', () => {
    const options = buildStyleOptions({
      faces: SANS_FACES.filter(face => face.family === 'Inter'),
      currentFace: null,
    })
    expect(options).toEqual([
      {
        value: 'Inter-Regular',
        label: '常规',
        detail: 'Inter Regular',
      },
      { value: 'Inter-Bold', label: '粗体', detail: 'Inter Bold' },
      { value: 'Inter-Italic', label: '斜体', detail: 'Inter Italic' },
    ])
  })

  test('style options fall back to the default marker without a regular face', () => {
    const options = buildStyleOptions({
      faces: [
        {
          family: 'OddFace',
          fullName: 'OddFace Bold',
          postscriptName: 'OddFace-Bold',
          style: 'Bold',
        },
      ],
      currentFace: null,
    })
    expect(options[0]).toEqual({ value: DEFAULT_FACE_VALUE, label: '常规' })
  })

  test('style options preserve a stored face missing from the enumeration', () => {
    const options = buildStyleOptions({
      faces: MONO_FACES,
      currentFace: {
        family: 'CodeMono',
        fullName: 'CodeMono Missing',
        postscriptName: 'CodeMono-Missing',
      },
    })
    expect(options.map(option => option.value)).toEqual([
      'CodeMono-Regular',
      'CodeMono-Bold',
      'CodeMono-Missing',
    ])
  })

  test('system default commits family null and face null', () => {
    expect(fontPatchForSelection({
      familyValue: SYSTEM_DEFAULT_FAMILY_VALUE,
      faceValue: DEFAULT_FACE_VALUE,
      familyFaces: MONO_FACES,
      currentFace: null,
    })).toEqual({ family: null, face: null })
  })

  test('the default face commits family-only and non-default faces save the face', () => {
    const regular = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: DEFAULT_FACE_VALUE,
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(regular).toEqual({ family: 'CodeMono', face: null })

    const bold = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: 'CodeMono-Bold',
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(bold).toEqual({
      family: 'CodeMono',
      face: {
        family: 'CodeMono',
        fullName: 'CodeMono Bold',
        postscriptName: 'CodeMono-Bold',
      },
    })

    const regularFaceOption = fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: 'CodeMono-Regular',
      familyFaces: MONO_FACES,
      currentFace: null,
    })
    expect(regularFaceOption).toEqual({ family: 'CodeMono', face: null })
  })

  test('an unenumerated stored face is preserved on commit', () => {
    const currentFace = {
      family: 'CodeMono',
      fullName: 'CodeMono Missing',
      postscriptName: 'CodeMono-Missing',
    }
    expect(fontPatchForSelection({
      familyValue: 'CodeMono',
      faceValue: 'CodeMono-Missing',
      familyFaces: MONO_FACES,
      currentFace,
    })).toEqual({ family: 'CodeMono', face: currentFace })
  })
})

describe('renderer V6 → V7 normalization', () => {
  test('preserves every V6 value and adds null faces', () => {
    const migrated = normalizeDesktopThemeSettings({
      version: 6,
      mode: 'dark',
      codeThemeIds: { light: 'github-light-default', dark: 'dracula' },
      chromeThemes: {
        light: {
          accent: '#abcdef',
          surface: '#fefefe',
          ink: '#111111',
          contrast: 42,
          fonts: { ui: 'Inter', code: 'JetBrains Mono' },
          semanticColors: {
            diffAdded: '#00a240',
            diffRemoved: '#ba2623',
            skill: '#924ff7',
          },
        },
        dark: {
          accent: '#339cff',
          surface: '#181818',
          ink: '#ffffff',
          contrast: 60,
          fonts: { ui: null, code: null },
          semanticColors: {
            diffAdded: '#40c977',
            diffRemoved: '#fa423e',
            skill: '#ad7bf9',
          },
        },
      },
      pointerCursorEnabled: true,
      reduceMotion: 'off',
      fontSmoothingEnabled: false,
      fontSizes: { ui: 15, code: 13 },
    })

    expect(migrated).toMatchObject({
      version: 7,
      mode: 'dark',
      codeThemeIds: { light: 'github-light-default', dark: 'dracula' },
      pointerCursorEnabled: true,
      reduceMotion: 'off',
      fontSmoothingEnabled: false,
      fontSizes: { ui: 15, code: 13 },
    })
    expect(migrated.chromeThemes.light).toMatchObject({
      accent: '#abcdef',
      surface: '#fefefe',
      ink: '#111111',
      contrast: 42,
    })
    expect(migrated.chromeThemes.light.fonts).toEqual({
      ui: 'Inter',
      uiFace: null,
      code: 'JetBrains Mono',
      codeFace: null,
    })
  })

  test('keeps valid faces and drops invalid or oversized ones', () => {
    const normalized = normalizeDesktopThemeSettings({
      ...DEFAULT_DESKTOP_THEME_SETTINGS,
      chromeThemes: {
        light: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.light,
          fonts: {
            ui: 'Inter',
            uiFace: {
              family: 'Inter',
              fullName: 'Inter Bold',
              postscriptName: 'Inter-Bold',
            },
            codeFace: {
              family: 'X'.repeat(201),
              fullName: 'Y',
              postscriptName: 'Z',
            },
          },
        },
        dark: DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark,
      },
    })

    expect(normalized.chromeThemes.light.fonts.uiFace).toEqual({
      family: 'Inter',
      fullName: 'Inter Bold',
      postscriptName: 'Inter-Bold',
    })
    expect(normalized.chromeThemes.light.fonts.codeFace).toBeNull()
    expect(normalized.chromeThemes.dark.fonts).toEqual({
      ui: null,
      uiFace: null,
      code: null,
      codeFace: null,
    })
  })

  test('drops a face when it does not match the selected family', () => {
    const normalized = normalizeDesktopThemeSettings({
      ...DEFAULT_DESKTOP_THEME_SETTINGS,
      chromeThemes: {
        ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes,
        dark: {
          ...DEFAULT_DESKTOP_THEME_SETTINGS.chromeThemes.dark,
          fonts: {
            ui: 'Inter',
            uiFace: {
              family: 'JetBrains Mono',
              fullName: 'JetBrains Mono Bold',
              postscriptName: 'JetBrainsMono-Bold',
            },
          },
        },
      },
    })

    expect(normalized.chromeThemes.dark.fonts.ui).toBe('Inter')
    expect(normalized.chromeThemes.dark.fonts.uiFace).toBeNull()
  })
})
