import React, { useEffect, useState } from 'react'
import * as RadixSlider from '@radix-ui/react-slider'
import * as Tabs from '@radix-ui/react-tabs'
import { Laptop, Moon, Sun } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SegmentedControl } from './SegmentedControl.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { ColorPickerControl } from './ColorPickerControl.js'
import type {
  DesktopThemeConfigV1,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../../shared/types.js'
import {
  CODEX_THEME_PREFIX,
  DESKTOP_THEME_PRESETS,
  createDesktopCustomTheme,
  getDesktopThemeEntry,
  getDesktopThemeForSelection,
  getDesktopThemeIdForVariant,
  isBuiltinDesktopThemeId,
  isDesktopThemeVariant,
  normalizeDesktopThemeConfig,
  normalizeDesktopThemeSettings,
} from '../../../shared/theme.js'
import { useDesktopTheme } from '../theme/themeContext.js'

const THEME_MODE_OPTIONS: Array<{
  value: DesktopThemeMode
  label: string
  icon: React.ReactNode
}> = [
  { value: 'light', label: '浅色', icon: <Sun size={APP_ICON_SIZE} /> },
  { value: 'dark', label: '深色', icon: <Moon size={APP_ICON_SIZE} /> },
  { value: 'system', label: '系统', icon: <Laptop size={APP_ICON_SIZE} /> },
]

const FIXED_THEME_PREVIEW_PANES: Array<{
  tone: 'red' | 'green'
  lines: Array<{ key: string; value: string }>
}> = [
  {
    tone: 'red',
    lines: [
      { key: 'surface', value: '"sidebar"' },
      { key: 'accent', value: '"#2563eb"' },
      { key: 'contrast', value: '42' },
    ],
  },
  {
    tone: 'green',
    lines: [
      { key: 'surface', value: '"sidebar-elevated"' },
      { key: 'accent', value: '"#0ea5e9"' },
      { key: 'contrast', value: '68' },
    ],
  },
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
  min,
  max,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
}) {
  const [inputValue, setInputValue] = useState(String(value))

  useEffect(() => {
    setInputValue(String(value))
  }, [value])

  const handleChange = (nextValue: string): void => {
    setInputValue(nextValue)
    if (!nextValue.trim()) return

    const parsed = Number.parseInt(nextValue, 10)
    if (!Number.isFinite(parsed)) return
    onChange(clampNumber(parsed, min, max))
  }

  const handleBlur = (): void => {
    const parsed = Number.parseInt(inputValue, 10)
    if (!Number.isFinite(parsed)) {
      setInputValue(String(value))
      return
    }
    const nextValue = clampNumber(parsed, min, max)
    setInputValue(String(nextValue))
    onChange(nextValue)
  }

  return (
    <div className="settings-input settings-input-compact">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={inputValue}
        onBlur={handleBlur}
        onChange={e => handleChange(e.target.value)}
        className="settings-input-number"
      />
      <span className="settings-input-unit">px</span>
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="settings-input settings-input-narrow"
    />
  )
}

export function AppearanceSettings() {
  const { settings, resolvedVariant, setMode, saveSettings } = useDesktopTheme()
  const activeThemeId = getDesktopThemeIdForVariant(settings, resolvedVariant)
  const activeThemeEntry = getDesktopThemeEntry(settings, activeThemeId)
  const activeTheme = getDesktopThemeForSelection(settings, resolvedVariant)
  const activeThemeIsBuiltin = isBuiltinDesktopThemeId(activeThemeId)
  const activeThemeCanReset = activeThemeIsBuiltin
    ? Boolean(settings.presetOverrides[activeThemeId])
    : Boolean(getSourcePresetId(activeThemeEntry))
  const [usePointer, setUsePointer] = useState(true)
  const [reduceMotion, setReduceMotion] = useState<'system' | 'on' | 'off'>(
    'system',
  )
  const [diffMarker, setDiffMarker] = useState<'color' | '+/-'>('color')
  const [pet, setPet] = useState('codex')
  const activeThemeOptions = getThemeDropdownOptions(settings, resolvedVariant)

  const updateActiveTheme = (
    updater: (theme: DesktopThemeConfigV1) => DesktopThemeConfigV1,
  ): void => {
    const nextTheme = updater(activeTheme)
    if (activeThemeIsBuiltin) {
      void saveSettings({
        ...settings,
        presetOverrides: {
          ...settings.presetOverrides,
          [activeThemeId]: nextTheme,
        },
      })
      return
    }

    void saveSettings({
      ...settings,
      customThemes: settings.customThemes.map(theme =>
        theme.id === activeThemeId ? { ...theme, config: nextTheme } : theme,
      ),
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

  const updateFontSizes = (
    patch: Partial<DesktopThemeSettings['fontSizes']>,
  ): void => {
    void saveSettings({
      ...settings,
      fontSizes: {
        ...settings.fontSizes,
        ...patch,
      },
    })
  }

  const handleCopyTheme = (): void => {
    const payload = activeThemeIsBuiltin
      ? {
          label: activeThemeEntry?.label ?? activeTheme.codeThemeId,
          config: activeTheme,
        }
      : {
          id: activeThemeId,
          label: activeThemeEntry?.label ?? activeTheme.codeThemeId,
          config: activeTheme,
        }
    const text = `${CODEX_THEME_PREFIX}${JSON.stringify(payload)}`
    const copyPromise = navigator.clipboard?.writeText(text)
    if (!copyPromise) {
      window.prompt('复制主题', text)
      return
    }
    void copyPromise.catch(() => {
      window.prompt('复制主题', text)
    })
  }

  const handleCopyPreset = (): void => {
    if (!activeThemeIsBuiltin) return
    const customTheme = createDesktopCustomTheme(
      activeTheme,
      `${activeThemeEntry?.label ?? activeTheme.codeThemeId} Custom`,
      settings.customThemes,
      activeThemeId,
    )
    void saveSettings({
      ...settings,
      activeThemeIds: {
        ...settings.activeThemeIds,
        [resolvedVariant]: customTheme.id,
      },
      customThemes: [...settings.customThemes, customTheme],
    })
  }

  const handleResetTheme = (): void => {
    if (activeThemeIsBuiltin) {
      const { [activeThemeId]: _removed, ...presetOverrides } =
        settings.presetOverrides
      void saveSettings({
        ...settings,
        presetOverrides,
      })
      return
    }

    const sourcePresetId = getSourcePresetId(activeThemeEntry)
    const sourcePreset = DESKTOP_THEME_PRESETS.find(
      preset => preset.id === sourcePresetId,
    )
    if (!sourcePreset) return

    void saveSettings({
      ...settings,
      customThemes: settings.customThemes.map(theme =>
        theme.id === activeThemeId
          ? { ...theme, config: sourcePreset.config }
          : theme,
      ),
    })
  }

  const handleImportTheme = (): void => {
    const input = window.prompt('粘贴 CodePilotX 主题配置或 JSON')
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

  const handleSelectTheme = (
    variant: DesktopThemeVariant,
    themeId: string,
  ): void => {
    void saveSettings({
      ...settings,
      activeThemeIds: {
        ...settings.activeThemeIds,
        [variant]: themeId,
      },
    })
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
            {FIXED_THEME_PREVIEW_PANES.map(pane => (
              <ThemePreviewPane
                key={pane.tone}
                lines={pane.lines}
                tone={pane.tone}
              />
            ))}
          </div>
        </section>

        <section className="settings-section appearance-theme-controls-section">
          <div className="settings-card appearance-theme-controls-card">
            <div className="appearance-theme-controls-header">
              <h3 className="settings-section-title">
                {resolvedVariant === 'dark' ? '深色主题' : '浅色主题'}
              </h3>
              <div className="appearance-theme-controls-actions">
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
                disabled={!activeThemeIsBuiltin}
                onClick={handleCopyPreset}
              >
                复制主题
              </button>
              <button
                type="button"
                className="settings-button ghost"
                disabled={!activeThemeCanReset}
                onClick={handleResetTheme}
              >
                重置主题
              </button>
              <button
                type="button"
                className="settings-button ghost"
                onClick={handleCopyTheme}
              >
                导出
              </button>
              <SettingsDropdown
                value={activeThemeId}
                options={activeThemeOptions}
                onChange={themeId => handleSelectTheme(resolvedVariant, themeId)}
                variant="theme"
              />
              </div>
            </div>
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
                placeholder="Inter, system-ui"
              />
            }
          />
          <SettingsRow
            title="代码字体"
            control={
              <TextInput
                value={activeTheme.theme.fonts.code}
                onChange={code => updateThemeFonts({ code })}
                placeholder="Consolas, monospace"
              />
            }
          />
          <SettingsRow
            title="半透明侧边栏"
            control={
              <ToggleSwitch
                checked={!activeTheme.theme.opaqueWindows}
                onChange={translucent =>
                  updateThemeTokens({ opaqueWindows: !translucent })
                }
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
          </div>
        </section>

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
            description="调整 CodePilotX UI 使用的基准字号"
            control={
              <NumberInput
                value={settings.fontSizes.ui}
                min={11}
                max={20}
                onChange={ui => updateFontSizes({ ui })}
              />
            }
          />
          <SettingsRow
            title="代码字号"
            description="调整聊天和差异视图中的代码字号"
            control={
              <NumberInput
                value={settings.fontSizes.code}
                min={10}
                max={20}
                onChange={code => updateFontSizes({ code })}
              />
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
                  { value: 'codex', label: 'CodePilotX' },
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
    return mergeImportedSettings(
      currentSettings,
      normalizeDesktopThemeSettings(parsed),
    )
  }

  const themeValue = isThemeExportShape(parsed) ? parsed.config : parsed
  if (isThemeConfigShape(themeValue)) {
    const variant = isDesktopThemeVariant(themeValue.variant)
      ? themeValue.variant
      : resolvedVariant
    const theme = normalizeDesktopThemeConfig(
      themeValue,
      variant,
      getDesktopThemeForSelection(currentSettings, variant),
    )
    const label =
      isThemeExportShape(parsed) && isNonEmptyString(parsed.label)
        ? parsed.label.trim()
        : theme.codeThemeId
    const themeId =
      isThemeExportShape(parsed) && isNonEmptyString(parsed.id)
        ? parsed.id.trim()
        : undefined

    return upsertImportedCustomTheme(currentSettings, theme, label, themeId)
  }

  throw new Error('Unsupported theme JSON shape.')
}

function mergeImportedSettings(
  currentSettings: DesktopThemeSettings,
  importedSettings: DesktopThemeSettings,
): DesktopThemeSettings {
  const customThemes = [...currentSettings.customThemes]
  for (const importedTheme of importedSettings.customThemes) {
    const existingIndex = customThemes.findIndex(
      theme => theme.id === importedTheme.id,
    )
    if (existingIndex >= 0) {
      customThemes[existingIndex] = importedTheme
    } else {
      customThemes.push(importedTheme)
    }
  }

  return {
    ...currentSettings,
    mode: importedSettings.mode,
    activeThemeIds: importedSettings.activeThemeIds,
    customThemes,
    presetOverrides: {
      ...currentSettings.presetOverrides,
      ...importedSettings.presetOverrides,
    },
  }
}

function upsertImportedCustomTheme(
  currentSettings: DesktopThemeSettings,
  theme: DesktopThemeConfigV1,
  label: string,
  themeId?: string,
): DesktopThemeSettings {
  if (themeId && isBuiltinDesktopThemeId(themeId)) {
    return {
      ...currentSettings,
      mode: theme.variant,
      activeThemeIds: {
        ...currentSettings.activeThemeIds,
        [theme.variant]: themeId,
      },
      presetOverrides: {
        ...currentSettings.presetOverrides,
        [themeId]: theme,
      },
    }
  }

  const existingIndex = themeId
    ? currentSettings.customThemes.findIndex(
        item => item.id === themeId && item.config.variant === theme.variant,
      )
    : -1

  if (existingIndex >= 0) {
    const customThemes = currentSettings.customThemes.map((item, index) =>
      index === existingIndex ? { ...item, label, config: theme } : item,
    )
    return {
      ...currentSettings,
      mode: theme.variant,
      activeThemeIds: {
        ...currentSettings.activeThemeIds,
        [theme.variant]: themeId,
      },
      customThemes,
    }
  }

  const customTheme = createDesktopCustomTheme(
    theme,
    label,
    currentSettings.customThemes,
  )
  return {
    ...currentSettings,
    mode: theme.variant,
    activeThemeIds: {
      ...currentSettings.activeThemeIds,
      [theme.variant]: customTheme.id,
    },
    customThemes: [...currentSettings.customThemes, customTheme],
  }
}

function isSettingsShape(value: unknown): value is DesktopThemeSettings {
  return (
    isRecord(value) &&
    ('themes' in value ||
      'activeThemeIds' in value ||
      'customThemes' in value ||
      'presetOverrides' in value)
  )
}

function isThemeConfigShape(value: unknown): value is DesktopThemeConfigV1 {
  return isRecord(value) && 'theme' in value
}

function isThemeExportShape(
  value: unknown,
): value is { id?: unknown; label?: unknown; config: unknown } {
  return isRecord(value) && 'config' in value
}

function getThemeDropdownOptions(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): Array<{ value: string; label: string; icon: React.ReactNode }> {
  return [
    ...DESKTOP_THEME_PRESETS.filter(
      preset => preset.config.variant === variant,
    ).map(preset => ({
      value: preset.id,
      label: preset.label,
      icon: <ThemeOptionIcon theme={preset.config} />,
    })),
    ...settings.customThemes
      .filter(theme => theme.config.variant === variant)
      .map(theme => ({
        value: theme.id,
        label: theme.label,
        icon: <ThemeOptionIcon theme={theme.config} />,
      })),
  ]
}

function ThemeOptionIcon({
  theme,
}: {
  theme: DesktopThemeConfigV1
}): React.ReactNode {
  return (
    <span
      className="appearance-theme-option-icon"
      style={{
        backgroundColor: theme.theme.surface,
        color: theme.theme.accent,
      }}
    >
      Aa
    </span>
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getSourcePresetId(
  entry: ReturnType<typeof getDesktopThemeEntry>,
): string | undefined {
  if (!entry || !('sourcePresetId' in entry)) return undefined
  return entry.sourcePresetId
}
