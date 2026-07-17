import React, { useEffect, useId, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import {
  Download,
  X,
} from 'lucide-react'

import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import type {
  DesktopChromeTheme,
  DesktopDiffMarkerStyle,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../../shared/types.js'
import {
  parseCodexThemeShare,
  serializeCodexThemeShare,
} from '../../../shared/themeShare.js'
import {
  syntaxTokenStyle,
  useHighlightedCode,
} from '../syntax/index.js'
import { getThemesForVariant } from '../syntax/theme.js'
import { useDesktopTheme } from '../theme/themeContext.js'
import {
  loadChromeThemeSeed,
  mergeChromeThemeSeed,
} from '../theme/codeThemeSeed.js'
import { SegmentedControl } from './SegmentedControl.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { useDesktopSettings } from './useDesktopSettings.js'

type Props = {
  onError?: (message: string) => void
  onNotice?: (message: string) => void
}

const VARIANTS = ['light', 'dark'] as const
const HEX_COLOR = /^#[0-9a-f]{6}$/i

const THEME_MODE_OPTIONS: Array<{
  value: DesktopThemeMode
  label: string
}> = [
  { value: 'system', label: '系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

function NumberInput({
  ariaLabel,
  value,
  onChange,
  min,
  max,
}: {
  ariaLabel: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
}) {
  const [inputValue, setInputValue] = useState(String(value))

  useEffect(() => setInputValue(String(value)), [value])

  const commit = (): void => {
    const parsed = Number.parseInt(inputValue, 10)
    if (!Number.isFinite(parsed)) {
      setInputValue(String(value))
      return
    }
    const next = Math.min(max, Math.max(min, parsed))
    setInputValue(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="appearance-number-input">
      <Input
        aria-label={ariaLabel}
        max={max}
        min={min}
        size="compact"
        type="number"
        value={inputValue}
        onBlur={commit}
        onChange={event => setInputValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setInputValue(String(value))
            event.currentTarget.blur()
          }
        }}
      />
      <span aria-hidden="true">px</span>
    </div>
  )
}

function FontInput({
  ariaLabel,
  placeholder,
  value,
  onCommit,
}: {
  ariaLabel: string
  placeholder: string
  value: string | null
  onCommit: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])

  const commit = (): void => {
    const next = draft.trim() || null
    setDraft(next ?? '')
    if (next !== value) onCommit(next)
  }

  return (
    <Input
      aria-label={ariaLabel}
      className="appearance-font-input"
      placeholder={placeholder}
      value={draft}
      onBlur={commit}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value ?? '')
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function ColorControl({
  ariaLabel,
  value,
  onCommit,
}: {
  ariaLabel: string
  value: `#${string}`
  onCommit: (value: `#${string}`) => void
}) {
  const normalizedValue = value.toUpperCase() as `#${string}`
  const [draft, setDraft] = useState(normalizedValue)
  useEffect(() => setDraft(normalizedValue), [normalizedValue])

  const commit = (): void => {
    if (!HEX_COLOR.test(draft)) {
      setDraft(normalizedValue)
      return
    }
    const next = draft.toUpperCase() as `#${string}`
    setDraft(next)
    if (next !== normalizedValue) onCommit(next)
  }

  const foreground = getReadableColor(normalizedValue)

  return (
    <div
      className="appearance-color-control"
      style={{
        backgroundColor: normalizedValue,
        color: foreground,
      }}
    >
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            aria-label={`${ariaLabel}颜色选择器`}
            className="appearance-color-swatch"
            style={{ backgroundColor: normalizedValue }}
            type="button"
          />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            className="popover-surface appearance-color-popover"
            collisionPadding={12}
            sideOffset={6}
          >
            <ColorPalette
              value={normalizedValue}
              onChange={next => {
                setDraft(next)
                onCommit(next)
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Input
        aria-label={ariaLabel}
        invalid={!HEX_COLOR.test(draft)}
        maxLength={7}
        spellCheck={false}
        value={draft}
        onBlur={commit}
        onChange={event => {
          const sanitized = sanitizeHexColor(event.target.value)
          setDraft(sanitized as `#${string}`)
          if (HEX_COLOR.test(sanitized)) {
            const next = sanitized.toUpperCase() as `#${string}`
            setDraft(next)
            onCommit(next)
          }
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(normalizedValue)
            event.currentTarget.blur()
          }
        }}
        style={{ color: foreground }}
      />
    </div>
  )
}

function sanitizeHexColor(value: string): string {
  const characters = value.toUpperCase().replace(/[^#0-9A-F]/g, '')
  return `#${characters.replaceAll('#', '').slice(0, 6)}`
}

function getReadableColor(value: string): '#101010' | '#FFFFFF' {
  const [red, green, blue] = hexToRgb(value)
  const luminance =
    (0.2126 * linearColor(red) +
      0.7152 * linearColor(green) +
      0.0722 * linearColor(blue))
  return luminance > 0.62 ? '#101010' : '#FFFFFF'
}

function linearColor(value: number): number {
  const channel = value / 255
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.replace('#', '').padEnd(6, '0')
  return [0, 2, 4].map(offset =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  ) as [number, number, number]
}

function rgbToHex(red: number, green: number, blue: number): `#${string}` {
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

function rgbToHsv(
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  const [r, g, b] = [red, green, blue].map(channel => channel / 255)
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const delta = maximum - minimum
  let hue = 0
  if (delta !== 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6)
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
  }
  return [
    hue < 0 ? hue + 360 : hue,
    maximum === 0 ? 0 : delta / maximum,
    maximum,
  ]
}

function hsvToRgb(
  hue: number,
  saturation: number,
  value: number,
): [number, number, number] {
  const chroma = value * saturation
  const segment = hue / 60
  const intermediate = chroma * (1 - Math.abs((segment % 2) - 1))
  const [red, green, blue] =
    segment < 1 ? [chroma, intermediate, 0]
      : segment < 2 ? [intermediate, chroma, 0]
        : segment < 3 ? [0, chroma, intermediate]
          : segment < 4 ? [0, intermediate, chroma]
            : segment < 5 ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate]
  const match = value - chroma
  return [
    (red + match) * 255,
    (green + match) * 255,
    (blue + match) * 255,
  ]
}

function ColorPalette({
  value,
  onChange,
}: {
  value: `#${string}`
  onChange: (value: `#${string}`) => void
}): React.ReactNode {
  const [hue, saturation, brightness] = rgbToHsv(...hexToRgb(value))
  const hueColor = rgbToHex(...hsvToRgb(hue, 1, 1))

  const updateSaturation = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const nextSaturation = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    )
    const nextBrightness = Math.max(
      0,
      Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height),
    )
    event.currentTarget.setPointerCapture(event.pointerId)
    onChange(rgbToHex(...hsvToRgb(hue, nextSaturation, nextBrightness)))
  }

  return (
    <div className="appearance-color-palette">
      <div
        aria-label="颜色饱和度与亮度"
        className="appearance-color-palette-square"
        role="slider"
        style={{ '--appearance-picker-hue': hueColor } as React.CSSProperties}
        tabIndex={0}
        onPointerDown={updateSaturation}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updateSaturation(event)
          }
        }}
      >
        <span
          className="appearance-color-palette-thumb"
          style={{
            left: `${saturation * 100}%`,
            top: `${(1 - brightness) * 100}%`,
          }}
        />
      </div>
      <input
        aria-label="色相"
        className="appearance-color-hue"
        max={359}
        min={0}
        type="range"
        value={Math.round(hue)}
        onChange={event =>
          onChange(
            rgbToHex(
              ...hsvToRgb(
                Number.parseInt(event.target.value, 10),
                saturation,
                brightness,
              ),
            ),
          )
        }
      />
    </div>
  )
}

function ThemeModeCard({
  mode,
  selected,
  label,
  onSelect,
}: {
  mode: DesktopThemeMode
  selected: boolean
  label: string
  onSelect: () => void
}) {
  return (
    <label
      className="appearance-mode-card"
      data-mode={mode}
      data-state={selected ? 'checked' : 'unchecked'}
    >
      <input
        checked={selected}
        name="appearance-theme"
        type="radio"
        value={mode}
        onChange={onSelect}
      />
      <span aria-hidden="true" className="appearance-mode-visual">
        <ThemeModePreview mode={mode} />
      </span>
      <span className="appearance-mode-label">{label}</span>
    </label>
  )
}

function ThemeModePreview({
  mode,
}: {
  mode: DesktopThemeMode
}): React.ReactNode {
  if (mode === 'system') {
    return (
      <svg viewBox="0 0 170 120">
        <defs>
          <clipPath id="appearance-system-preview-sheet">
            <path d="M7 42a8 8 0 0 1 8-8h140a8 8 0 0 1 8 8v78H7V42Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#appearance-system-preview-sheet)">
          <path fill="#f3f3f3" d="M7 34h78v86H7z" />
          <path fill="#393939" d="M85 34h78v86H85z" />
          <path
            fill="#cdcdcd"
            d="M73 59h12v6H73a3 3 0 0 1 0-6Z"
          />
          <path fill="#767676" d="M85 59h9a3 3 0 0 1 0 6h-9Z" />
          <path fill="#dfdfdf" d="M53 68h32v3H53z" />
          <path fill="#8f8f8f" d="M85 68h32v3H85z" />
          <path
            fill="#fff"
            d="M26 84a7 7 0 0 1 7-7h52v43H26V84Z"
          />
          <path
            fill="#4f4f4f"
            d="M85 77h52a7 7 0 0 1 7 7v36H85V77Z"
          />
          <path
            fill="#dfdfdf"
            d="M32 88a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6H35a3 3 0 0 1-3-3Z"
          />
          <path
            fill="#767676"
            d="M103 88a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6h-29a3 3 0 0 1-3-3Z"
          />
          <path
            fill="#f3f3f3"
            d="M32 96h53v2H32zM26 105h59v1H26z"
          />
          <path
            fill="#767676"
            d="M85 96h53v2H85zM85 105h59v1H85z"
          />
          <path
            fill="#dfdfdf"
            d="M32 114a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6H35a3 3 0 0 1-3-3Z"
          />
          <path
            fill="#767676"
            d="M103 114a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6h-29a3 3 0 0 1-3-3Z"
          />
        </g>
      </svg>
    )
  }

  const dark = mode === 'dark'
  return (
    <svg viewBox="0 0 170 120">
      <path
        fill={dark ? '#9f9f9f' : '#cdcdcd'}
        d="M49 26h72a3 3 0 0 1 0 6H49a3 3 0 0 1 0-6Z"
      />
      <path
        fill={dark ? '#8f8f8f' : '#dfdfdf'}
        d="M28 35h114a2 2 0 0 1 0 4H28a2 2 0 0 1 0-4Z"
      />
      <path
        fill="#fff"
        d="M15 52a8 8 0 0 1 8-8h124a8 8 0 0 1 8 8v68H15V52Z"
      />
      <path
        fill="#dfdfdf"
        d="M22 59a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z"
      />
      <path fill="#f3f3f3" d="M22 67h65v2H22zM15 76h140v1H15z" />
      <path
        fill="#dfdfdf"
        d="M22 83a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z"
      />
      <path fill="#f3f3f3" d="M22 91h65v2H22zM15 100h140v1H15z" />
      <path
        fill="#dfdfdf"
        d="M22 107a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z"
      />
      <path fill="#f3f3f3" d="M22 115h65v2H22z" />
    </svg>
  )
}

const BEFORE_THEME_PREVIEW = [
  'const themePreview: ThemeConfig = {',
  '  surface: "sidebar",',
  '  accent: "#2563eb",',
  '  contrast: 42,',
  '};',
].join('\n')

const AFTER_THEME_PREVIEW = [
  'const themePreview: ThemeConfig = {',
  '  surface: "sidebar-elevated",',
  '  accent: "#0ea5e9",',
  '  contrast: 68,',
  '};',
].join('\n')

function ThemePreview({
  variant,
  theme,
  codeThemeId,
  markerStyle,
}: {
  variant: DesktopThemeVariant
  theme: DesktopChromeTheme
  codeThemeId: string
  markerStyle: DesktopDiffMarkerStyle
}) {
  const before = useHighlightedCode({
    code: BEFORE_THEME_PREVIEW,
    language: 'typescript',
    theme: codeThemeId,
  })
  const after = useHighlightedCode({
    code: AFTER_THEME_PREVIEW,
    language: 'typescript',
    theme: codeThemeId,
  })
  const style = {
    '--appearance-preview-surface': theme.surface,
    '--appearance-preview-ink': theme.ink,
    '--appearance-preview-accent': theme.accent,
    '--appearance-preview-added': theme.semanticColors.diffAdded,
    '--appearance-preview-removed': theme.semanticColors.diffRemoved,
  } as React.CSSProperties

  return (
    <div
      aria-label={`${variant === 'light' ? '浅色' : '深色'}主题差异预览`}
      className="appearance-diff-preview"
      data-diff-style="split"
      data-expansion-line-count="8"
      data-hunk-separators="line-info"
      data-line-diff-type="none"
      data-overflow="scroll"
      data-marker-style={markerStyle}
      data-variant={variant}
      style={style}
    >
      <div className="appearance-diff-file-header">src/theme-preview.ts</div>
      <div className="appearance-diff-hunk-header">@@ -1,5 +1,5 @@</div>
      <div className="appearance-diff-split">
        <ThemePreviewSide
          changedLines={new Set([1, 2, 3])}
          lineTone="removed"
          presentation={before}
          source={BEFORE_THEME_PREVIEW}
        />
        <ThemePreviewSide
          changedLines={new Set([1, 2, 3])}
          lineTone="added"
          presentation={after}
          source={AFTER_THEME_PREVIEW}
        />
      </div>
    </div>
  )
}

function ThemePreviewSide({
  changedLines,
  lineTone,
  presentation,
  source,
}: {
  changedLines: ReadonlySet<number>
  lineTone: 'added' | 'removed'
  presentation: ReturnType<typeof useHighlightedCode>
  source: string
}): React.ReactNode {
  const fallbackLines = source.split('\n')
  return (
    <div className="appearance-diff-side">
      {fallbackLines.map((line, lineIndex) => {
        const tone = changedLines.has(lineIndex) ? lineTone : 'context'
        const tokens = presentation.highlighted?.tokens[lineIndex]
        return (
          <div
            className="appearance-diff-line"
            data-tone={tone}
            key={`${lineIndex}:${line}`}
          >
            <span className="appearance-diff-line-number">{lineIndex + 1}</span>
            <span className="appearance-diff-marker" aria-hidden="true">
              {tone === 'removed' ? '−' : tone === 'added' ? '+' : ''}
            </span>
            <code>
              {tokens?.length
                ? tokens.map((token, tokenIndex) => (
                    <span
                      key={`${lineIndex}:${tokenIndex}`}
                      style={syntaxTokenStyle(token)}
                    >
                      {token.content}
                    </span>
                  ))
                : line || ' '}
            </code>
          </div>
        )
      })}
    </div>
  )
}

function ThemeShareDialog({
  open,
  variant,
  value,
  onOpenChange,
  onImport,
}: {
  open: boolean
  variant: DesktopThemeVariant
  value: string
  onOpenChange: (open: boolean) => void
  onImport: (value: string) => void
}) {
  const titleId = useId()
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop">
          <Dialog.Content
            aria-labelledby={titleId}
            className="appearance-import-dialog"
          >
            <header>
              <Dialog.Title id={titleId}>
                导入{variant === 'light' ? '浅色' : '深色'}主题
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button aria-label="关闭导入对话框" size="icon" variant="ghost">
                  <X
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </Button>
              </Dialog.Close>
            </header>
            <Dialog.Description>
              粘贴以 codex-theme-v1: 开头的主题内容。导入前会严格校验主题类型和所有颜色。
            </Dialog.Description>
            <textarea
              aria-label="Codex 主题内容"
              autoFocus
              spellCheck={false}
              value={draft}
              onChange={event => setDraft(event.target.value)}
            />
            <footer>
              <Dialog.Close asChild>
                <Button variant="secondary">取消</Button>
              </Dialog.Close>
              <Button
                disabled={!draft.trim()}
                variant="primary"
                onClick={() => onImport(draft)}
              >
                <Download size={APP_ICON_SIZE} />
                导入主题
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function VariantThemeEditor({
  variant,
  settings,
  onUpdate,
  onError,
  onNotice,
  backdropSupported,
}: {
  variant: DesktopThemeVariant
  settings: DesktopThemeSettings
  onUpdate: (settings: DesktopThemeSettings) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
  backdropSupported: boolean
}) {
  const [importOpen, setImportOpen] = useState(false)
  const chromeTheme = settings.chromeThemes[variant]
  const codeThemeId = settings.codeThemeIds[variant]
  const variantLabel = variant === 'light' ? '浅色' : '深色'
  const themes = useMemo(() => getThemesForVariant(variant), [variant])
  const [themeSeeds, setThemeSeeds] = useState<
    Record<string, Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'>>
  >({})

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      themes.map(async theme => ({
        slug: theme.slug,
        seed: await loadChromeThemeSeed(theme.slug, variant),
      })),
    ).then(entries => {
      if (cancelled) return
      setThemeSeeds(
        Object.fromEntries(
          entries.map(({ slug, seed }) => [
            slug,
            {
              surface: seed.surface,
              ink: seed.ink,
              accent: seed.accent,
            },
          ]),
        ),
      )
    })
    return () => {
      cancelled = true
    }
  }, [themes, variant])

  const codeThemeOptions = useMemo(
    () =>
      themes.map(theme => {
        const seed = themeSeeds[theme.slug]
        return {
          value: theme.slug,
          label: theme.label,
          icon: (
            <span
              aria-hidden="true"
              className="appearance-theme-seed"
              style={
                seed
                  ? {
                      backgroundColor: seed.surface,
                      color: seed.accent,
                      borderColor: `color-mix(in srgb, ${seed.ink} 18%, transparent)`,
                    }
                  : undefined
              }
            >
              Aa
            </span>
          ),
        }
      }),
    [themeSeeds, themes],
  )

  const updateChromeTheme = (patch: Partial<DesktopChromeTheme>): void => {
    onUpdate({
      ...settings,
      chromeThemes: {
        ...settings.chromeThemes,
        [variant]: { ...chromeTheme, ...patch },
      },
    })
  }

  const updateFonts = (
    patch: Partial<DesktopChromeTheme['fonts']>,
  ): void => {
    updateChromeTheme({
      fonts: { ...chromeTheme.fonts, ...patch },
    })
  }

  const copyTheme = async (): Promise<void> => {
    try {
      const serialized = serializeCodexThemeShare({
        variant,
        codeThemeId,
        theme: chromeTheme,
      })
      await navigator.clipboard.writeText(serialized)
      onNotice(`${variantLabel}主题已复制`)
    } catch (error) {
      onError(error instanceof Error ? error.message : '复制主题失败')
    }
  }

  const importTheme = (raw: string): void => {
    try {
      const imported = parseCodexThemeShare(raw, variant)
      onUpdate({
        ...settings,
        codeThemeIds: {
          ...settings.codeThemeIds,
          [variant]: imported.codeThemeId,
        },
        chromeThemes: {
          ...settings.chromeThemes,
          [variant]: imported.theme,
        },
      })
      setImportOpen(false)
      onNotice(`${variantLabel}主题已导入`)
    } catch (error) {
      onError(error instanceof Error ? error.message : '主题内容无效')
    }
  }

  return (
    <article className="appearance-theme-editor">
      <SettingsRow
        title={`${variantLabel}主题`}
        control={
          <div className="appearance-theme-editor-actions">
          <Button size="toolbar" variant="ghost" onClick={() => setImportOpen(true)}>
            导入
          </Button>
          <Button size="toolbar" variant="ghost" onClick={() => void copyTheme()}>
            复制主题
          </Button>
          <SettingsDropdown
            ariaLabel={`${variantLabel}代码主题`}
            options={codeThemeOptions}
            showSelectedIndicator
            value={codeThemeId}
            variant="theme"
            width={176}
            onChange={nextId => {
              const nextCodeThemeId =
                nextId as DesktopThemeSettings['codeThemeIds'][typeof variant]
              void Promise.resolve(
                loadChromeThemeSeed(nextCodeThemeId, variant),
              )
                .then(seed => {
                  onUpdate({
                    ...settings,
                    codeThemeIds: {
                      ...settings.codeThemeIds,
                      [variant]: nextCodeThemeId,
                    },
                    chromeThemes: {
                      ...settings.chromeThemes,
                      [variant]: mergeChromeThemeSeed(chromeTheme, seed),
                    },
                  })
                })
                .catch(error => {
                  onError(
                    error instanceof Error
                      ? error.message
                      : '无法加载代码主题',
                  )
                })
            }}
          />
          </div>
        }
      />

      <div className="appearance-theme-editor-rows">
        <SettingsRow
          title="强调色"
          size="compact"
          control={
            <ColorControl
              ariaLabel={`${variantLabel}强调色`}
              value={chromeTheme.accent}
              onCommit={accent => updateChromeTheme({ accent })}
            />
          }
        />
        <SettingsRow
          title="背景"
          size="compact"
          control={
            <ColorControl
              ariaLabel={`${variantLabel}背景色`}
              value={chromeTheme.surface}
              onCommit={surface => updateChromeTheme({ surface })}
            />
          }
        />
        <SettingsRow
          title="前景"
          size="compact"
          control={
            <ColorControl
              ariaLabel={`${variantLabel}前景色`}
              value={chromeTheme.ink}
              onCommit={ink => updateChromeTheme({ ink })}
            />
          }
        />
        <SettingsRow
          title="UI 字体"
          size="compact"
          control={
            <FontInput
              ariaLabel={`${variantLabel}界面字体`}
              placeholder="ui-sans-serif, system-ui, sans-serif"
              value={chromeTheme.fonts.ui}
              onCommit={ui => updateFonts({ ui })}
            />
          }
        />
        <SettingsRow
          title="代码字体"
          size="compact"
          control={
            <FontInput
              ariaLabel={`${variantLabel}代码字体`}
              placeholder="ui-monospace, SFMono-Regular, Consolas, monospace"
              value={chromeTheme.fonts.code}
              onCommit={code => updateFonts({ code })}
            />
          }
        />
        {backdropSupported ? (
          <SettingsRow
            autoSave
            title="半透明侧边栏"
            size="compact"
            control={
              <ToggleSwitch
                checked={!chromeTheme.opaqueWindows}
                onChange={translucent =>
                  updateChromeTheme({ opaqueWindows: !translucent })
                }
              />
            }
          />
        ) : null}
        <SettingsRow
          title="对比度"
          size="compact"
          control={
            <label className="appearance-contrast-control">
              <input
                aria-label={`${variantLabel}对比度`}
                max={100}
                min={0}
                style={{
                  '--appearance-slider-accent': chromeTheme.accent,
                  '--appearance-slider-surface': chromeTheme.surface,
                } as React.CSSProperties}
                type="range"
                value={chromeTheme.contrast}
                onChange={event =>
                  updateChromeTheme({
                    contrast: Number.parseInt(event.target.value, 10),
                  })
                }
              />
              <output>{chromeTheme.contrast}</output>
            </label>
          }
        />
      </div>

      <ThemeShareDialog
        open={importOpen}
        value=""
        variant={variant}
        onImport={importTheme}
        onOpenChange={setImportOpen}
      />
    </article>
  )
}

export function AppearanceSettings({
  onError,
  onNotice,
}: Props): React.ReactNode {
  const theme = useDesktopTheme()
  const desktopSettings = useDesktopSettings()
  const { settings, resolvedVariant } = theme.draft
  const visibleVariants =
    settings.mode === 'system' ? VARIANTS : ([resolvedVariant] as const)

  const reportError = onError ?? (() => undefined)
  const reportNotice = onNotice ?? (() => undefined)

  const saveThemeSettings = (next: DesktopThemeSettings): void => {
    theme.draft.setSettings(next)
    theme.draft.autoSave(next)
  }

  const updateThemeSettings = (
    patch: Partial<DesktopThemeSettings>,
  ): void => {
    saveThemeSettings({ ...settings, ...patch })
  }

  const updateDiffMarkerStyle = (
    diffMarkerStyle: DesktopDiffMarkerStyle,
  ): void => {
    desktopSettings.draft.setValue('diffMarkerStyle', diffMarkerStyle)
    desktopSettings.draft.autoSave()
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner appearance-settings">
        <div className="settings-page-header">
          <h2 className="settings-page-title">外观</h2>
        </div>

        <SettingsSection bare title="主题">
          <div
            aria-label="外观模式"
            className="appearance-mode-gallery"
            role="radiogroup"
            onKeyDown={event => {
              const keyOffsets: Partial<Record<string, number>> = {
                ArrowLeft: -1,
                ArrowUp: -1,
                ArrowRight: 1,
                ArrowDown: 1,
              }
              const currentIndex = THEME_MODE_OPTIONS.findIndex(
                option => option.value === settings.mode,
              )
              let nextIndex = currentIndex
              if (event.key === 'Home') nextIndex = 0
              else if (event.key === 'End') {
                nextIndex = THEME_MODE_OPTIONS.length - 1
              } else if (keyOffsets[event.key]) {
                nextIndex =
                  (currentIndex +
                    (keyOffsets[event.key] ?? 0) +
                    THEME_MODE_OPTIONS.length) %
                  THEME_MODE_OPTIONS.length
              } else {
                return
              }

              event.preventDefault()
              const nextMode = THEME_MODE_OPTIONS[nextIndex]?.value
              if (!nextMode) return
              const nextInput =
                event.currentTarget.querySelector<HTMLInputElement>(
                  `input[value="${nextMode}"]`,
                )
              nextInput?.focus()
              nextInput?.click()
            }}
          >
            {THEME_MODE_OPTIONS.map(option => (
              <ThemeModeCard
                key={option.value}
                label={option.label}
                mode={option.value}
                selected={settings.mode === option.value}
                onSelect={() => {
                  saveThemeSettings({ ...settings, mode: option.value })
                }}
              />
            ))}
          </div>

          <ThemePreview
            codeThemeId={settings.codeThemeIds[resolvedVariant]}
            markerStyle={desktopSettings.draft.values.diffMarkerStyle}
            theme={settings.chromeThemes[resolvedVariant]}
            variant={resolvedVariant}
          />

          <div className="appearance-theme-editors">
            {visibleVariants.map(variant => (
              <VariantThemeEditor
                key={variant}
                settings={settings}
                variant={variant}
                backdropSupported={theme.backdropSupported}
                onError={reportError}
                onNotice={reportNotice}
                onUpdate={saveThemeSettings}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection title="偏好设置">
          <SettingsRow
            autoSave
            title="使用指针光标"
            description="悬停按钮、菜单等交互元素时显示手形指针"
            control={
              <ToggleSwitch
                ariaLabel="使用指针光标"
                checked={settings.pointerCursorEnabled}
                onChange={pointerCursorEnabled =>
                  updateThemeSettings({ pointerCursorEnabled })
                }
              />
            }
          />
          <SettingsRow
            autoSave
            title="差异标记"
            description="使用彩色背景，或在更改行显示 + / - 符号"
            control={
              <SegmentedControl
                ariaLabel="差异标记选项"
                options={[
                  { value: 'color', label: '颜色' },
                  { value: 'symbol', label: '+/-' },
                ]}
                value={desktopSettings.draft.values.diffMarkerStyle}
                onChange={updateDiffMarkerStyle}
              />
            }
          />
          <SettingsRow
            title="界面字号"
            control={
              <NumberInput
                ariaLabel="界面字号"
                max={16}
                min={11}
                value={settings.fontSizes.ui}
                onChange={ui =>
                  updateThemeSettings({
                    fontSizes: { ...settings.fontSizes, ui },
                  })
                }
              />
            }
          />
          <SettingsRow
            title="代码字号"
            control={
              <NumberInput
                ariaLabel="代码字号"
                max={24}
                min={8}
                value={settings.fontSizes.code}
                onChange={code =>
                  updateThemeSettings({
                    fontSizes: { ...settings.fontSizes, code },
                  })
                }
              />
            }
          />
          <SettingsRow
            autoSave
            title="减少动态效果"
            description="跟随系统，或始终开启、关闭界面动画"
            control={
              <SegmentedControl
                ariaLabel="减少动态效果选项"
                options={[
                  { value: 'system', label: '系统' },
                  { value: 'on', label: '开启' },
                  { value: 'off', label: '关闭' },
                ]}
                value={settings.reduceMotion}
                onChange={reduceMotion => updateThemeSettings({ reduceMotion })}
              />
            }
          />
          {navigator.platform.toLowerCase().includes('mac') ? (
            <SettingsRow
              autoSave
              title="字体平滑"
              description="在 macOS 上优化浅色文字边缘"
              control={
                <ToggleSwitch
                  checked={settings.fontSmoothingEnabled}
                  onChange={fontSmoothingEnabled =>
                    updateThemeSettings({ fontSmoothingEnabled })
                  }
                />
              }
            />
          ) : null}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
