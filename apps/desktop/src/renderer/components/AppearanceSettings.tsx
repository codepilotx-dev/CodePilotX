import React, { useState } from 'react'
import * as RadixSlider from '@radix-ui/react-slider'
import * as Tabs from '@radix-ui/react-tabs'
import { Laptop, Moon, Sun } from 'lucide-react'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SegmentedControl } from './SegmentedControl.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { ColorPickerControl } from './ColorPickerControl.js'
import type {
  DesktopThemeConfigV1,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../shared/types.js'
import {
  CODEX_THEME_PREFIX,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DESKTOP_THEME_PRESETS,
  getDesktopThemeForVariant,
  isDesktopThemeVariant,
  normalizeDesktopThemeConfig,
  normalizeDesktopThemeSettings,
} from '../../shared/theme.js'
import { useDesktopTheme } from '../features/theme/themeContext.js'

const THEME_MODE_OPTIONS: Array<{
  value: DesktopThemeMode
  label: string
  icon: React.ReactNode
}> = [
  { value: 'light', label: '浅色', icon: <Sun size={24} /> },
  { value: 'dark', label: '深色', icon: <Moon size={24} /> },
  { value: 'system', label: '系统', icon: <Laptop size={24} /> },
]

function Slider({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="appearance-slider-wrap">
      <RadixSlider.Root
        className="appearance-slider"
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={values => onChange(values[0] ?? value)}
      >
        <RadixSlider.Track className="appearance-slider-track">
          <RadixSlider.Range className="appearance-slider-range" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="appearance-slider-thumb" />
      </RadixSlider.Root>
      <span className="appearance-slider-value">{value}</span>
    </div>
  )
}

function NumberInput({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="settings-input settings-input-compact">
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="settings-input-number"
      />
      <span className="settings-input-unit">px</span>
    </div>
  )
}

function TextInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="settings-input settings-input-narrow"
    />
  )
}

export function AppearanceSettings() {
  const { settings, resolvedVariant, setMode, saveSettings } = useDesktopTheme()
  const activeTheme = getDesktopThemeForVariant(settings, resolvedVariant)
  const [usePointer, setUsePointer] = useState(true)
  const [reduceMotion, setReduceMotion] = useState<'system' | 'on' | 'off'>(
    'system',
  )
  const [uiFontSize, setUiFontSize] = useState(14)
  const [codeFontSize, setCodeFontSize] = useState(12)
  const [diffMarker, setDiffMarker] = useState<'color' | '+/-'>('color')
  const [pet, setPet] = useState('codex')
  const presetOptions = DESKTOP_THEME_PRESETS.filter(
    preset => preset.config.variant === resolvedVariant,
  )
  const activePresetId =
    presetOptions.find(preset => themesEqual(preset.config, activeTheme))?.id ??
    'custom'
  const themeDropdownOptions = [
    ...presetOptions.map(preset => ({
      value: preset.id,
      label: `Aa ${preset.label}`,
    })),
    ...(activePresetId === 'custom'
      ? [{ value: 'custom', label: `Aa ${activeTheme.codeThemeId}` }]
      : []),
  ]

  const previewLines = [
    { key: 'surface', value: JSON.stringify(activeTheme.theme.surface) },
    { key: 'accent', value: JSON.stringify(activeTheme.theme.accent) },
    { key: 'contrast', value: String(activeTheme.theme.contrast) },
  ]

  const updateActiveTheme = (
    updater: (theme: DesktopThemeConfigV1) => DesktopThemeConfigV1,
  ): void => {
    const nextTheme = updater(activeTheme)
    void saveSettings({
      ...settings,
      themes: {
        ...settings.themes,
        [resolvedVariant]: nextTheme,
      },
    })
  }

  const updateThemeTokens = (
    patch: Partial<DesktopThemeConfigV1['theme']>,
  ): void => {
    updateActiveTheme(theme => ({
      ...theme,
      theme: {
        ...theme.theme,
        ...patch,
      },
    }))
  }

  const updateThemeFonts = (
    patch: Partial<DesktopThemeConfigV1['theme']['fonts']>,
  ): void => {
    updateActiveTheme(theme => ({
      ...theme,
      theme: {
        ...theme.theme,
        fonts: {
          ...theme.theme.fonts,
          ...patch,
        },
      },
    }))
  }

  const handleCopyTheme = (): void => {
    const text = `${CODEX_THEME_PREFIX}${JSON.stringify(activeTheme)}`
    const copyPromise = navigator.clipboard?.writeText(text)
    if (!copyPromise) {
      window.prompt('复制主题', text)
      return
    }
    void copyPromise.catch(() => {
      window.prompt('复制主题', text)
    })
  }

  const handleImportTheme = (): void => {
    const input = window.prompt('粘贴 codex-theme-v1 或 JSON 主题配置')
    if (!input) return

    const raw = input.trim().startsWith(CODEX_THEME_PREFIX)
      ? input.trim().slice(CODEX_THEME_PREFIX.length)
      : input.trim()

    try {
      const parsed = JSON.parse(raw) as unknown
      const nextSettings = parseImportedTheme(parsed, settings, resolvedVariant)
      void saveSettings(nextSettings)
    } catch {
      window.alert('主题 JSON 无法解析。')
    }
  }

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">外观</h2>

        <section className="appearance-theme-preview">
          <div className="appearance-mode-header">
            <div className="appearance-mode-copy">
              <h2 className="appearance-mode-title">主题</h2>
              <p className="appearance-mode-desc">
                使用浅色、深色，或匹配系统设置。
              </p>
            </div>
            <div className="appearance-mode-toggle" role="tablist" aria-label="主题模式">
              <Tabs.Root
                value={settings.mode}
                onValueChange={value => void setMode(value as DesktopThemeMode)}
              >
                <Tabs.List className="appearance-mode-list">
              {THEME_MODE_OPTIONS.map(option => (
                <Tabs.Trigger
                  key={option.value}
                  type="button"
                  className={`appearance-mode-option ${
                    settings.mode === option.value ? 'active' : ''
                  }`}
                  value={option.value}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </Tabs.Trigger>
              ))}
                </Tabs.List>
              </Tabs.Root>
            </div>
          </div>

          <div className="appearance-preview">
            <ThemePreviewPane lines={previewLines} tone="red" />
            <ThemePreviewPane lines={previewLines} tone="green" />
          </div>
        </section>

        <SettingsSection
          title={resolvedVariant === 'dark' ? '深色主题' : '浅色主题'}
          actions={
            <>
              <button
                type="button"
                className="settings-button link"
                onClick={handleImportTheme}
              >
                导入
              </button>
              <button
                type="button"
                className="settings-button ghost"
                onClick={handleCopyTheme}
              >
                复制主题
              </button>
              <SettingsDropdown
                value={activePresetId}
                options={themeDropdownOptions}
                onChange={presetId => {
                  const preset = presetOptions.find(item => item.id === presetId)
                  if (!preset) return
                  void saveSettings({
                    ...settings,
                    themes: {
                      ...settings.themes,
                      [preset.config.variant]: preset.config,
                    },
                  })
                }}
              />
            </>
          }
        >
          <SettingsRow
            title="强调色"
            control={
              <ColorPickerControl
                ariaLabel="强调色"
                value={activeTheme.theme.accent}
                onChange={accent => updateThemeTokens({ accent })}
              />
            }
          />
          <SettingsRow
            title="背景"
            control={
              <ColorPickerControl
                ariaLabel="背景"
                value={activeTheme.theme.surface}
                onChange={surface => updateThemeTokens({ surface })}
              />
            }
          />
          <SettingsRow
            title="前景"
            control={
              <ColorPickerControl
                ariaLabel="前景"
                value={activeTheme.theme.ink}
                onChange={ink => updateThemeTokens({ ink })}
              />
            }
          />
          <SettingsRow
            title="UI 字体"
            control={
              <TextInput
                value={activeTheme.theme.fonts.ui}
                onChange={ui => updateThemeFonts({ ui })}
              />
            }
          />
          <SettingsRow
            title="代码字体"
            control={
              <TextInput
                value={activeTheme.theme.fonts.code}
                onChange={code => updateThemeFonts({ code })}
              />
            }
          />
          <SettingsRow
            title="不透明窗口"
            control={
              <ToggleSwitch
                checked={activeTheme.theme.opaqueWindows}
                onChange={opaqueWindows => updateThemeTokens({ opaqueWindows })}
              />
            }
          />
          <SettingsRow
            title="对比度"
            control={
              <Slider
                value={activeTheme.theme.contrast}
                onChange={contrast => updateThemeTokens({ contrast })}
              />
            }
          />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow
            title="使用指针光标"
            description="悬停交互元素时切换为指针光标"
            control={<ToggleSwitch checked={usePointer} onChange={setUsePointer} />}
          />
          <SettingsRow
            title="减少动态效果"
            description="减少动画效果或匹配系统设置"
            control={
              <SegmentedControl
                value={reduceMotion}
                options={[
                  { value: 'system', label: '系统' },
                  { value: 'on', label: '开启' },
                  { value: 'off', label: '关闭' },
                ]}
                onChange={setReduceMotion}
              />
            }
          />
          <SettingsRow
            title="UI 字号"
            description="调整 Codex UI 使用的基准字号"
            control={<NumberInput value={uiFontSize} onChange={setUiFontSize} />}
          />
          <SettingsRow
            title="代码字号"
            description="调整聊天和差异视图中的代码字号"
            control={
              <NumberInput value={codeFontSize} onChange={setCodeFontSize} />
            }
          />
          <SettingsRow
            title="差异标记"
            description="使用彩色背景，或在每个更改行上显示 + / - 符号"
            control={
              <SegmentedControl
                value={diffMarker}
                options={[
                  { value: 'color', label: '颜色' },
                  { value: '+/-', label: '+/-' },
                ]}
                onChange={setDiffMarker}
              />
            }
          />
          <SettingsRow
            title="宠物"
            description="在 UI 中显示虚拟宠物"
            control={
              <SettingsDropdown
                value={pet}
                options={[
                  { value: 'codex', label: 'Codex' },
                  { value: 'off', label: '关闭' },
                ]}
                onChange={setPet}
              />
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}

function ThemePreviewPane({
  lines,
  tone,
}: {
  lines: Array<{ key: string; value: string }>
  tone: 'red' | 'green'
}) {
  return (
    <div className={`appearance-preview-pane appearance-preview-${tone}`}>
      <div className="appearance-preview-line">
        <div className="appearance-preview-lineno">1</div>
        <div className="appearance-preview-code">
          <span className="appearance-syntax-keyword">const</span>
          <span> </span>
          <span className="appearance-syntax-name">themePreview</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-type">ThemeConfig</span>
          <span> </span>
          <span className="appearance-syntax-operator">=</span>
          <span> </span>
          <span className="appearance-syntax-punct">{'{'}</span>
        </div>
      </div>
      {lines.map((line, i) => (
        <div
          key={line.key}
          className="appearance-preview-line appearance-preview-line-highlight"
        >
          <div className="appearance-preview-lineno">{i + 2}</div>
          <div className="appearance-preview-code">
            <span className="appearance-syntax-prop">{line.key}</span>
            <span className="appearance-syntax-punct">: </span>
            <span
              className={
                line.key === 'contrast'
                  ? 'appearance-syntax-number'
                  : 'appearance-syntax-string'
              }
            >
              {line.value}
            </span>
            <span className="appearance-syntax-punct">,</span>
          </div>
        </div>
      ))}
      <div className="appearance-preview-line">
        <div className="appearance-preview-lineno">5</div>
        <div className="appearance-preview-code">
          <span className="appearance-syntax-punct">{'};'}</span>
        </div>
      </div>
    </div>
  )
}

function parseImportedTheme(
  parsed: unknown,
  currentSettings: DesktopThemeSettings,
  resolvedVariant: DesktopThemeVariant,
): DesktopThemeSettings {
  if (isSettingsShape(parsed)) {
    return normalizeDesktopThemeSettings(parsed)
  }

  if (isThemeConfigShape(parsed)) {
    const variant = isDesktopThemeVariant(parsed.variant)
      ? parsed.variant
      : resolvedVariant
    const fallback = variant === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME
    const theme = normalizeDesktopThemeConfig(parsed, variant, fallback)
    return {
      ...currentSettings,
      mode: variant,
      themes: {
        ...currentSettings.themes,
        [variant]: theme,
      },
    }
  }

  throw new Error('Unsupported theme JSON shape.')
}

function isSettingsShape(value: unknown): value is DesktopThemeSettings {
  return Boolean(value) && typeof value === 'object' && 'themes' in value
}

function isThemeConfigShape(value: unknown): value is DesktopThemeConfigV1 {
  return Boolean(value) && typeof value === 'object' && 'theme' in value
}

function themesEqual(
  left: DesktopThemeConfigV1,
  right: DesktopThemeConfigV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
