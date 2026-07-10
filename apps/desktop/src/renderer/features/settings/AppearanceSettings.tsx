import React, { useEffect, useRef, useState } from 'react'
import * as RadixSlider from '@radix-ui/react-slider'
import { Laptop, Moon, Sun } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { ColorPickerControl } from './ColorPickerControl.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SegmentedControl } from './SegmentedControl.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import type {
  DesktopDiffMarkerStyle,
  DesktopThemeConfigV1,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../../shared/types.js'
import {
  CODEPILOTX_THEME_PREFIX,
  DEFAULT_CODE_FONT,
  DEFAULT_UI_FONT,
  DESKTOP_THEME_PRESETS,
  createDesktopCustomTheme,
  exportDesktopThemeConfig,
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

function Slider({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    setDisplayValue(value)
  }, [value])

  return (
    <div className="appearance-slider-wrap">
      <RadixSlider.Root
        className="appearance-slider"
        min={0}
        max={100}
        step={1}
        value={[displayValue]}
        onValueChange={values => {
          const nextValue = values[0] ?? value
          setDisplayValue(nextValue)
          onChange(nextValue)
        }}
      >
        <RadixSlider.Track className="appearance-slider-track">
          <RadixSlider.Range className="appearance-slider-range" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="appearance-slider-thumb" />
      </RadixSlider.Root>
      <span className="appearance-slider-value">{displayValue}</span>
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

function FontStackInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState(value)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setInputValue(value)
    }
  }, [value])

  const handleChange = (nextValue: string): void => {
    setInputValue(nextValue)
    onChange(nextValue)
  }

  const handleBlur = (): void => {
    setInputValue(value)
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={inputValue}
      onBlur={handleBlur}
      onChange={e => handleChange(e.target.value)}
      placeholder={placeholder}
      className="settings-input settings-input-narrow"
    />
  )
}

function fontEntryToStack(
  entry: DesktopThemeConfigV1['theme']['fonts']['ui'],
): string {
  return [entry.preset, entry.fallback].filter(Boolean).join(', ')
}

function splitFontFamilyStack(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (const char of value) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char
      current += char
      continue
    }
    if (char === ',' && !quote) {
      const part = current.trim()
      if (part) parts.push(part)
      current = ''
      continue
    }
    current += char
  }

  const tail = current.trim()
  if (tail) parts.push(tail)
  return parts
}

function fontStackToEntry(
  value: string,
  fallback: DesktopThemeConfigV1['theme']['fonts']['ui'],
): DesktopThemeConfigV1['theme']['fonts']['ui'] {
  const parts = splitFontFamilyStack(value)
  if (parts.length === 0) return fallback
  return {
    preset: parts[0] ?? fallback.preset,
    fallback: parts.slice(1).join(', ') || fallback.fallback,
  }
}

export function AppearanceSettings() {
  const theme = useDesktopTheme()
  const desktopSettings = useDesktopSettings()
  const { settings, resolvedVariant } = theme.draft
  const saveSettings = theme.draft.setSettings
  const activeThemeId = getDesktopThemeIdForVariant(settings, resolvedVariant)
  const activeThemeEntry = getDesktopThemeEntry(settings, activeThemeId)
  const activeTheme = getDesktopThemeForSelection(settings, resolvedVariant)
  const activeThemeIsBuiltin = isBuiltinDesktopThemeId(activeThemeId)
  const activeThemeCanReset = activeThemeIsBuiltin
    ? Boolean(settings.presetOverrides[activeThemeId])
    : Boolean(getSourcePresetId(activeThemeEntry))
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

  const updateUiFontStack = (stack: string): void => {
    updateThemeFonts({
      ui: stack.trim()
        ? fontStackToEntry(stack, DEFAULT_UI_FONT)
        : DEFAULT_UI_FONT,
    })
  }

  const updateCodeFontStack = (stack: string): void => {
    updateThemeFonts({
      code: stack.trim()
        ? fontStackToEntry(stack, DEFAULT_CODE_FONT)
        : DEFAULT_CODE_FONT,
    })
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

  const updateGlassmorphism = (glassmorphismEnabled: boolean): void => {
    saveSettings({
      ...settings,
      glassmorphismEnabled,
    })
    theme.draft.autoSave()
  }

  const updatePointerCursor = (pointerCursorEnabled: boolean): void => {
    saveSettings({
      ...settings,
      pointerCursorEnabled,
    })
    theme.draft.autoSave()
  }

  const updateReduceMotion = (
    reduceMotion: DesktopThemeSettings['reduceMotion'],
  ): void => {
    saveSettings({
      ...settings,
      reduceMotion,
    })
    theme.draft.autoSave()
  }

  const updateDiffMarkerStyle = (
    diffMarkerStyle: DesktopDiffMarkerStyle,
  ): void => {
    desktopSettings.draft.setValue('diffMarkerStyle', diffMarkerStyle)
    desktopSettings.draft.autoSave()
  }

  const handleCopyTheme = (): void => {
    const cleanConfig = exportDesktopThemeConfig(activeTheme)
    const payload = activeThemeIsBuiltin
      ? {
          label: activeThemeEntry?.label ?? activeTheme.codeThemeId,
          config: cleanConfig,
        }
      : {
          id: activeThemeId,
          label: activeThemeEntry?.label ?? activeTheme.codeThemeId,
          config: cleanConfig,
        }
    const text = `${CODEPILOTX_THEME_PREFIX}${JSON.stringify(payload)}`
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

    const raw = input.trim().startsWith(CODEPILOTX_THEME_PREFIX)
      ? input.trim().slice(CODEPILOTX_THEME_PREFIX.length)
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
    // Look up the target theme's base config
    const preset = DESKTOP_THEME_PRESETS.find(p => p.id === themeId)

    if (preset) {
      if (preset.config.variant !== variant) return

      // Built-in theme: take color fields from preset base, keep non-color
      // fields from the currently active theme (fonts, contrast, opaqueWindows)
      const mergedConfig: DesktopThemeConfigV1 = {
        ...preset.config,
        theme: {
          ...preset.config.theme,
          fonts: activeTheme.theme.fonts,
          contrast: activeTheme.theme.contrast,
          opaqueWindows: activeTheme.theme.opaqueWindows,
        },
      }

      void saveSettings({
        ...settings,
        activeThemeIds: {
          ...settings.activeThemeIds,
          [variant]: themeId,
        },
        presetOverrides: {
          ...settings.presetOverrides,
          [themeId]: mergedConfig,
        },
      })
      theme.draft.autoSave()
      return
    }

    // Custom theme: same merge strategy
    const customEntry = settings.customThemes.find(t => t.id === themeId)
    if (!customEntry || customEntry.config.variant !== variant) return

    const mergedConfig: DesktopThemeConfigV1 = {
      ...customEntry.config,
      theme: {
        ...customEntry.config.theme,
        fonts: activeTheme.theme.fonts,
        contrast: activeTheme.theme.contrast,
        opaqueWindows: activeTheme.theme.opaqueWindows,
      },
    }

    void saveSettings({
      ...settings,
      activeThemeIds: {
        ...settings.activeThemeIds,
        [variant]: themeId,
      },
      customThemes: settings.customThemes.map(theme =>
        theme.id === themeId ? { ...theme, config: mergedConfig } : theme,
      ),
    })
    theme.draft.autoSave()
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner appearance-console appearance-prototype">
        <div className="settings-page-header">
          <h2 className="settings-page-title appearance-title">外观</h2>
        </div>

        <section
          aria-label="主题模式"
          className="appearance-mode-gallery"
          role="radiogroup"
        >
          {THEME_MODE_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              aria-checked={settings.mode === option.value}
              className={`appearance-mode-card appearance-mode-card-${option.value} ${
                settings.mode === option.value ? 'is-active' : ''
              }`}
              onClick={() => {
                theme.draft.setMode(option.value)
                theme.draft.autoSave()
              }}
              role="radio"
            >
              <span className="appearance-mode-visual" aria-hidden="true">
                <span className="appearance-mode-window">
                  <span className="appearance-mode-lines" />
                  <span className="appearance-mode-sheet" />
                </span>
              </span>
              <span className="appearance-mode-label">{option.label}</span>
            </button>
          ))}
        </section>

        <ThemePreviewPane
          activeTheme={activeTheme}
          codeFontStack={fontEntryToStack(activeTheme.theme.fonts.code)}
          codeSize={settings.fontSizes.code}
          diffMarkerStyle={desktopSettings.draft.values.diffMarkerStyle}
        />

        <section className="settings-card appearance-core-card appearance-table-card">
          <div className="appearance-table-header">
            <h3>{resolvedVariant === 'dark' ? '深色主题' : '浅色主题'}</h3>
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
                className="settings-button link"
                disabled={!activeThemeIsBuiltin}
                onClick={handleCopyPreset}
              >
                复制主题
              </button>
              <button
                type="button"
                className="settings-button link"
                disabled={!activeThemeCanReset}
                onClick={handleResetTheme}
              >
                重置主题
              </button>
              <button
                type="button"
                className="settings-button link"
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
          <div className="appearance-table-body">
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
                <FontStackInput
                  value={fontEntryToStack(activeTheme.theme.fonts.ui)}
                  onChange={updateUiFontStack}
                  placeholder='MiSans VF Regular, MiSans, Inter'
                />
              }
            />
            <SettingsRow
              title="代码字体"
              control={
                <FontStackInput
                  value={fontEntryToStack(activeTheme.theme.fonts.code)}
                  onChange={updateCodeFontStack}
                  placeholder='JetBrains Mono, Consolas, monospace'
                />
              }
            />
            <SettingsRow
              title="半透明侧边栏"
              autoSave
              control={
                <ToggleSwitch
                  checked={!activeTheme.theme.opaqueWindows}
                  onChange={translucent => {
                    updateThemeTokens({ opaqueWindows: !translucent })
                    theme.draft.autoSave()
                  }}
                />
              }
            />
            <SettingsRow
              title="弹层玻璃效果"
              description="为弹窗和下拉框启用半透明模糊背景"
              autoSave
              control={
                <ToggleSwitch
                  checked={settings.glassmorphismEnabled}
                  onChange={updateGlassmorphism}
                />
              }
            />
            <SettingsRow
              title="UI 字号"
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
            autoSave
            control={
              <ToggleSwitch
                checked={settings.pointerCursorEnabled}
                onChange={updatePointerCursor}
              />
            }
          />
          <SettingsRow
            title="减少动态效果"
            description="减少动画效果或匹配系统设置"
            autoSave
            control={
              <SegmentedControl
                value={settings.reduceMotion}
                options={[
                  { value: 'system', label: '系统' },
                  { value: 'on', label: '开启' },
                  { value: 'off', label: '关闭' },
                ]}
                onChange={updateReduceMotion}
              />
            }
          />
          <SettingsRow
            title="差异标记"
            description="使用彩色背景，或在每个更改行上显示 + / - 符号"
            autoSave
            control={
              <SegmentedControl
                value={desktopSettings.draft.values.diffMarkerStyle}
                options={[
                  { value: 'color', label: '颜色' },
                  { value: 'symbol', label: '+/-' },
                ]}
                onChange={updateDiffMarkerStyle}
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
    </SettingsContentArea>
  )
}

function ThemePreviewPane({
  activeTheme,
  codeFontStack,
  codeSize,
  diffMarkerStyle,
}: {
  activeTheme: DesktopThemeConfigV1
  codeFontStack: string
  codeSize: number
  diffMarkerStyle: DesktopDiffMarkerStyle
}) {
  return (
    <div
      className={`appearance-diff-preview theme-${activeTheme.variant} marker-${diffMarkerStyle}`}
      style={{ fontFamily: codeFontStack, fontSize: codeSize }}
    >
      <div className="appearance-diff-pane appearance-diff-pane-removed">
        <CodeLine number={1}>
          <span className="appearance-syntax-keyword">const</span>
          <span> themePreview</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-type">ThemeConfig</span>
          <span> </span>
          <span className="appearance-syntax-operator">=</span>
          <span> </span>
          <span className="appearance-syntax-punct">{'{'}</span>
        </CodeLine>
        <CodeLine number={2} tone="removed">
          <span className="appearance-syntax-prop">surface</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-string">"sidebar"</span>
          <span className="appearance-syntax-punct">,</span>
        </CodeLine>
        <CodeLine number={3} tone="removed">
          <span className="appearance-syntax-prop">accent</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-string">
            {`"${activeTheme.theme.accent}"`}
          </span>
          <span className="appearance-syntax-punct">,</span>
        </CodeLine>
        <CodeLine number={4} tone="removed">
          <span className="appearance-syntax-prop">contrast</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-number">
            {Math.max(0, activeTheme.theme.contrast - 26)}
          </span>
          <span className="appearance-syntax-punct">,</span>
        </CodeLine>
        <CodeLine number={5}>
          <span className="appearance-syntax-punct">{'};'}</span>
        </CodeLine>
      </div>
      <div className="appearance-diff-pane appearance-diff-pane-added">
        <CodeLine number={1}>
          <span className="appearance-syntax-keyword">const</span>
          <span> themePreview</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-type">ThemeConfig</span>
          <span> </span>
          <span className="appearance-syntax-operator">=</span>
          <span> </span>
          <span className="appearance-syntax-punct">{'{'}</span>
        </CodeLine>
        <CodeLine number={2} tone="added">
          <span className="appearance-syntax-prop">surface</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-string">"sidebar-elevated"</span>
          <span className="appearance-syntax-punct">,</span>
        </CodeLine>
        <CodeLine number={3} tone="added">
          <span className="appearance-syntax-prop">accent</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-string">
            {`"${activeTheme.theme.accent}"`}
          </span>
          <span className="appearance-syntax-punct">,</span>
        </CodeLine>
        <CodeLine number={4} tone="added">
          <span className="appearance-syntax-prop">contrast</span>
          <span className="appearance-syntax-punct">: </span>
          <span className="appearance-syntax-number">
            {activeTheme.theme.contrast}
          </span>
          <span className="appearance-syntax-punct">,</span>
        </CodeLine>
        <CodeLine number={5}>
          <span className="appearance-syntax-punct">{'};'}</span>
        </CodeLine>
      </div>
    </div>
  )
}

function CodeLine({
  children,
  number,
  tone,
}: {
  children: React.ReactNode
  number: number
  tone?: 'added' | 'removed'
}) {
  return (
    <div
      className={`appearance-preview-line${
        tone ? ` appearance-preview-line-${tone}` : ''
      }`}
    >
      <div className="appearance-preview-lineno">{number}</div>
      <div className="appearance-preview-marker" aria-hidden="true">
        {tone === 'added' ? '+' : tone === 'removed' ? '-' : ''}
      </div>
      <div className="appearance-preview-code">{children}</div>
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
    glassmorphismEnabled: importedSettings.glassmorphismEnabled,
    pointerCursorEnabled: importedSettings.pointerCursorEnabled,
    reduceMotion: importedSettings.reduceMotion,
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
  const options = [
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

  return options.sort((left, right) => {
    const labelOrder = left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
    })
    return labelOrder || left.value.localeCompare(right.value)
  })
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
