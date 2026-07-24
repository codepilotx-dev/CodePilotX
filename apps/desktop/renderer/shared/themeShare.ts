import {
  CODEX_HIGHLIGHT_THEMES,
  isCodexHighlightThemeSlug,
  type CodexHighlightThemeSlug,
} from './codexThemes/manifest.js'
import type {
  DesktopChromeTheme,
  DesktopThemeVariant,
} from './types.js'

export const CODEX_THEME_SHARE_PREFIX = 'codex-theme-v2:'

export type CodexThemeShareV2 = {
  version: 2
  variant: DesktopThemeVariant
  codeThemeId: CodexHighlightThemeSlug
  theme: DesktopChromeTheme
}

export function serializeCodexThemeShare(value: CodexThemeShareV2): string {
  const normalized = validatePayload(value)
  return `${CODEX_THEME_SHARE_PREFIX}${JSON.stringify(normalized)}`
}

export function parseCodexThemeShare(
  input: string,
  expectedVariant?: DesktopThemeVariant,
): CodexThemeShareV2 {
  if (input.startsWith('codex-theme-v1:')) {
    throw new Error('codex-theme-v1 主题已不再支持，请重新导出 V2 主题')
  }
  if (!input.startsWith(CODEX_THEME_SHARE_PREFIX)) {
    throw new Error('主题文本缺少 codex-theme-v2 前缀')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(input.slice(CODEX_THEME_SHARE_PREFIX.length))
  } catch {
    throw new Error('主题文本不是有效的 JSON')
  }
  const payload = validatePayload(decoded)
  if (expectedVariant && payload.variant !== expectedVariant) {
    throw new Error(`主题适用于 ${payload.variant}，无法导入到 ${expectedVariant}`)
  }
  return payload
}

function validatePayload(value: unknown): CodexThemeShareV2 {
  const object = strictObject(
    value,
    ['version', 'variant', 'codeThemeId', 'theme'],
    '主题',
  )
  if (object.version !== 2) {
    throw new Error('主题 version 必须是 2')
  }
  const variant = object.variant
  if (variant !== 'light' && variant !== 'dark') {
    throw new Error('主题 variant 必须是 light 或 dark')
  }
  if (!isCodexHighlightThemeSlug(object.codeThemeId)) {
    throw new Error('主题 codeThemeId 不存在')
  }
  if (
    !CODEX_HIGHLIGHT_THEMES.some(
      theme =>
        theme.slug === object.codeThemeId && theme.variant === variant,
    )
  ) {
    throw new Error('主题 codeThemeId 与 variant 不匹配')
  }
  const theme = validateChromeTheme(object.theme)
  return { version: 2, variant, codeThemeId: object.codeThemeId, theme }
}

function validateChromeTheme(value: unknown): DesktopChromeTheme {
  const theme = strictObject(
    value,
    [
      'accent',
      'surface',
      'ink',
      'contrast',
      'opaqueWindows',
      'fonts',
      'semanticColors',
    ],
    'Chrome theme',
  )
  if (
    typeof theme.contrast !== 'number' ||
    !Number.isFinite(theme.contrast) ||
    !Number.isInteger(theme.contrast) ||
    theme.contrast < 0 ||
    theme.contrast > 100
  ) {
    throw new Error('主题 contrast 必须在 0 到 100 之间')
  }
  if (typeof theme.opaqueWindows !== 'boolean') {
    throw new Error('主题 opaqueWindows 必须是布尔值')
  }
  const fonts = strictObject(theme.fonts, ['ui', 'code'], '主题 fonts')
  if (!isNullableString(fonts.ui) || !isNullableString(fonts.code)) {
    throw new Error('主题字体必须是字符串或 null')
  }
  const semantic = strictObject(
    theme.semanticColors,
    ['diffAdded', 'diffRemoved', 'skill'],
    '主题 semanticColors',
  )
  return {
    accent: requireHex(theme.accent, 'accent'),
    surface: requireHex(theme.surface, 'surface'),
    ink: requireHex(theme.ink, 'ink'),
    contrast: theme.contrast,
    opaqueWindows: theme.opaqueWindows,
    fonts: { ui: fonts.ui, code: fonts.code },
    semanticColors: {
      diffAdded: requireHex(semantic.diffAdded, 'diffAdded'),
      diffRemoved: requireHex(semantic.diffRemoved, 'diffRemoved'),
      skill: requireHex(semantic.skill, 'skill'),
    },
  }
}

function strictObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`)
  }
  const object = value as Record<string, unknown>
  const actual = Object.keys(object).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} 字段不完整或包含未知字段`)
  }
  return object
}

function requireHex(value: unknown, label: string): `#${string}` {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) {
    throw new Error(`主题 ${label} 必须是六位 HEX 颜色`)
  }
  return value.toLowerCase() as `#${string}`
}

function isNullableString(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.length <= 512)
  )
}
