import React, { useEffect, useId, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Clipboard,
  Download,
  Laptop,
  Moon,
  Sun,
  Upload,
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
import { CodeBlock } from '../syntax/index.js'
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
  icon: React.ReactNode
}> = [
  { value: 'light', label: '浅色', icon: <Sun size={APP_ICON_SIZE} /> },
  { value: 'dark', label: '深色', icon: <Moon size={APP_ICON_SIZE} /> },
  { value: 'system', label: '系统', icon: <Laptop size={APP_ICON_SIZE} /> },
]

function getCodeThemeOptions(
  variant: DesktopThemeVariant,
): Array<{ value: string; label: string; detail: string }> {
  return getThemesForVariant(variant).map(theme => ({
    value: theme.slug,
    label: theme.label,
    detail: `${variant === 'light' ? '浅色' : '深色'} · ${theme.slug}`,
  }))
}

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
  value,
  onCommit,
}: {
  ariaLabel: string
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
      placeholder="使用系统默认字体"
      value={draft}
      onBlur={commit}
          onChange={event =>
            setDraft(event.target.value as `#${string}`)
          }
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
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    if (!HEX_COLOR.test(draft)) {
      setDraft(value)
      return
    }
    const next = draft.toLowerCase() as `#${string}`
    setDraft(next)
    if (next !== value) onCommit(next)
  }

  return (
    <div className="appearance-color-control">
      <label
        aria-label={`${ariaLabel}颜色选择器`}
        className="appearance-color-swatch"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={value}
          onChange={event =>
            onCommit(event.target.value.toLowerCase() as `#${string}`)
          }
        />
      </label>
      <Input
        aria-label={ariaLabel}
        invalid={!HEX_COLOR.test(draft)}
        maxLength={7}
        spellCheck={false}
        value={draft}
        onBlur={commit}
        onChange={event =>
          setDraft(event.target.value as `#${string}`)
        }
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

function ThemeModeCard({
  mode,
  selected,
  label,
  icon,
  onSelect,
}: {
  mode: DesktopThemeMode
  selected: boolean
  label: string
  icon: React.ReactNode
  onSelect: () => void
}) {
  return (
    <button
      aria-checked={selected}
      className="appearance-mode-card"
      data-mode={mode}
      data-state={selected ? 'checked' : 'unchecked'}
      role="radio"
      tabIndex={selected ? 0 : -1}
      type="button"
      onClick={onSelect}
    >
      <span aria-hidden="true" className="appearance-mode-visual">
        <span className="appearance-mode-sidebar" />
        <span className="appearance-mode-composer" />
        <span className="appearance-mode-copy" />
      </span>
      <span className="appearance-mode-label">
        {icon}
        {label}
      </span>
    </button>
  )
}

function ThemePreview({
  variant,
  theme,
}: {
  variant: DesktopThemeVariant
  theme: DesktopChromeTheme
}) {
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
      data-variant={variant}
      style={style}
    >
      <div className="appearance-diff-pane appearance-diff-pane-removed">
        <span className="appearance-diff-caption">Before</span>
        <CodeBlock
          ariaLabel="修改前代码"
          code={'const theme = "legacy"\nreturn theme'}
          language="typescript"
        />
      </div>
      <div className="appearance-diff-pane appearance-diff-pane-added">
        <span className="appearance-diff-caption">After</span>
        <CodeBlock
          ariaLabel="修改后代码"
          code={'const theme = "codex"\nreturn theme'}
          language="typescript"
        />
      </div>
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
      <header className="appearance-theme-editor-header">
        <div>
          <h4>{variantLabel}主题</h4>
          <span>{codeThemeId}</span>
        </div>
        <div className="appearance-theme-editor-actions">
          <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
            <Upload size={APP_ICON_SIZE} />
            导入
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copyTheme()}>
            <Clipboard size={APP_ICON_SIZE} />
            复制主题
          </Button>
          <SettingsDropdown
            ariaLabel={`${variantLabel}代码主题`}
            options={getCodeThemeOptions(variant)}
            searchable
            searchPlaceholder="搜索代码主题…"
            value={codeThemeId}
            variant="theme"
            width={280}
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
      </header>

      <ThemePreview variant={variant} theme={chromeTheme} />

      <div className="appearance-theme-editor-rows">
        <SettingsRow
          title="强调色"
          control={
            <ColorControl
              ariaLabel={`${variantLabel}强调色`}
              value={chromeTheme.accent}
              onCommit={accent => updateChromeTheme({ accent })}
            />
          }
        />
        <SettingsRow
          title="背景色"
          control={
            <ColorControl
              ariaLabel={`${variantLabel}背景色`}
              value={chromeTheme.surface}
              onCommit={surface => updateChromeTheme({ surface })}
            />
          }
        />
        <SettingsRow
          title="前景色"
          control={
            <ColorControl
              ariaLabel={`${variantLabel}前景色`}
              value={chromeTheme.ink}
              onCommit={ink => updateChromeTheme({ ink })}
            />
          }
        />
        <SettingsRow
          title="界面字体"
          control={
            <FontInput
              ariaLabel={`${variantLabel}界面字体`}
              value={chromeTheme.fonts.ui}
              onCommit={ui => updateFonts({ ui })}
            />
          }
        />
        <SettingsRow
          title="代码字体"
          control={
            <FontInput
              ariaLabel={`${variantLabel}代码字体`}
              value={chromeTheme.fonts.code}
              onCommit={code => updateFonts({ code })}
            />
          }
        />
        {backdropSupported ? (
          <SettingsRow
            autoSave
            title="半透明侧边栏"
            description="使用系统材质时让窗口侧栏透出桌面背景"
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
          control={
            <label className="appearance-contrast-control">
              <input
                aria-label={`${variantLabel}对比度`}
                max={100}
                min={0}
                style={{
                  '--appearance-slider-accent': chromeTheme.accent,
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
    theme.draft.autoSave()
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
          <p>自定义 CodePilotX 的主题、代码高亮、字体与动态效果。</p>
        </div>

        <SettingsSection
          bare
          title="主题"
          description="外观模式、界面颜色和代码主题会作为一套配置保存。"
        >
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
              const nextCard =
                event.currentTarget.querySelector<HTMLButtonElement>(
                  `[data-mode="${nextMode}"]`,
                )
              nextCard?.focus()
              nextCard?.click()
            }}
          >
            {THEME_MODE_OPTIONS.map(option => (
              <ThemeModeCard
                key={option.value}
                icon={option.icon}
                label={option.label}
                mode={option.value}
                selected={settings.mode === option.value}
                onSelect={() => {
                  theme.draft.setMode(option.value)
                  theme.draft.autoSave()
                }}
              />
            ))}
          </div>

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
                checked={settings.pointerCursorEnabled}
                onChange={pointerCursorEnabled =>
                  updateThemeSettings({ pointerCursorEnabled })
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
                options={[
                  { value: 'system', label: '系统' },
                  { value: 'on', label: '开启' },
                  { value: 'off', label: '关闭' },
                ]}
                value={settings.reduceMotion}
                onChange={next => {
                  const reduceMotion =
                    typeof next === 'function'
                      ? next(settings.reduceMotion)
                      : next
                  updateThemeSettings({ reduceMotion })
                }}
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
            title="差异标记"
            description="使用彩色背景，或在更改行显示 + / - 符号"
            control={
              <SegmentedControl
                options={[
                  { value: 'color', label: '颜色' },
                  { value: 'symbol', label: '+/-' },
                ]}
                value={desktopSettings.draft.values.diffMarkerStyle}
                onChange={next => {
                  const current =
                    desktopSettings.draft.values.diffMarkerStyle
                  updateDiffMarkerStyle(
                    typeof next === 'function' ? next(current) : next,
                  )
                }}
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
