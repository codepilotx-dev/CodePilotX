import React, { useEffect, useState } from 'react'
import { Laptop, Moon, Sun } from 'lucide-react'

import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import type {
  DesktopDiffMarkerStyle,
  DesktopThemeMode,
  DesktopThemeSettings,
} from '../../../shared/types.js'
import { CodeBlock } from '../syntax/index.js'
import {
  getThemesForVariant,
  normalizeThemeIdForVariant,
} from '../syntax/theme.js'
import { useDesktopTheme } from '../theme/themeContext.js'
import { SegmentedControl } from './SegmentedControl.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { useDesktopSettings } from './useDesktopSettings.js'

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
  variant: 'light' | 'dark',
): Array<{ value: string; label: string; detail: string }> {
  return [
    {
      value: 'auto',
      label: '自动（Codex）',
      detail: '浅色使用 codex-light，深色使用 codex-dark',
    },
    ...getThemesForVariant(variant).map(
      theme => ({
        value: theme.slug,
        label: theme.label,
        detail: `${variant === 'light' ? '浅色' : '深色'} · ${theme.slug}`,
      }),
    ),
  ]
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
}) {
  const [inputValue, setInputValue] = useState(String(value))

  useEffect(() => {
    setInputValue(String(value))
  }, [value])

  const commit = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      setInputValue(String(value))
      return
    }
    const next = Math.min(max, Math.max(min, parsed))
    setInputValue(String(next))
    onChange(next)
  }

  return (
    <div className="settings-input settings-input-compact">
      <input
        aria-label="字号"
        className="settings-input-number"
        max={max}
        min={min}
        type="number"
        value={inputValue}
        onBlur={() => commit(inputValue)}
        onChange={event => {
          setInputValue(event.target.value)
          if (event.target.value.trim()) commit(event.target.value)
        }}
      />
      <span className="settings-input-unit">px</span>
    </div>
  )
}

export function AppearanceSettings() {
  const theme = useDesktopTheme()
  const desktopSettings = useDesktopSettings()
  const { settings, resolvedVariant } = theme.draft
  const configuredCodeThemeVariants =
    settings.mode === 'system'
      ? (['light', 'dark'] as const)
      : ([resolvedVariant] as const)

  const updateThemeSettings = (
    patch: Partial<DesktopThemeSettings>,
  ): void => {
    theme.draft.setSettings({ ...settings, ...patch })
    theme.draft.autoSave()
  }

  const updateFontSizes = (
    patch: Partial<DesktopThemeSettings['fontSizes']>,
  ): void => {
    updateThemeSettings({
      fontSizes: {
        ...settings.fontSizes,
        ...patch,
      },
    })
  }

  const updateCodeTheme = (
    variant: 'light' | 'dark',
    codeThemeId: string,
  ): void => {
    updateThemeSettings({
      codeThemeIds: {
        ...settings.codeThemeIds,
        [variant]: normalizeThemeIdForVariant(codeThemeId, variant),
      },
    })
  }

  const updateDiffMarkerStyle = (
    diffMarkerStyle: DesktopDiffMarkerStyle,
  ): void => {
    desktopSettings.draft.setValue('diffMarkerStyle', diffMarkerStyle)
    desktopSettings.draft.autoSave()
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner appearance-console appearance-prototype">
        <div className="settings-page-header">
          <h2 className="settings-page-title appearance-title">外观</h2>
        </div>

        <section
          aria-label="Codex 主题模式"
          className="appearance-mode-gallery"
          role="radiogroup"
        >
          {THEME_MODE_OPTIONS.map(option => (
            <button
              key={option.value}
              aria-checked={settings.mode === option.value}
              className={`appearance-mode-card appearance-mode-card-${option.value} ${
                settings.mode === option.value ? 'is-active' : ''
              }`}
              role="radio"
              type="button"
              onClick={() => {
                theme.draft.setMode(option.value)
                theme.draft.autoSave()
              }}
            >
              <span className="appearance-mode-visual" aria-hidden="true">
                <span className="appearance-mode-window">
                  <span className="appearance-mode-lines" />
                  <span className="appearance-mode-sheet" />
                </span>
              </span>
              <span className="appearance-mode-label">
                {option.icon}
                {option.label}
              </span>
            </button>
          ))}
        </section>

        <SettingsSection
          title="Codex 主题"
          description="应用界面固定使用 Codex Light / Dark；代码高亮主题不会改变界面配色。"
        >
          {configuredCodeThemeVariants.map(variant => (
            <SettingsRow
              key={variant}
              autoSave
              title={
                settings.mode === 'system'
                  ? `${variant === 'light' ? '浅色' : '深色'}代码高亮`
                  : '代码高亮'
              }
              description={
                settings.mode === 'system'
                  ? `系统处于${variant === 'light' ? '浅色' : '深色'}外观时应用`
                  : '仅显示与当前应用模式匹配的 Codex 主题'
              }
              control={
                <SettingsDropdown
                  ariaLabel={`${variant === 'light' ? '浅色' : '深色'}代码高亮主题`}
                  options={getCodeThemeOptions(variant)}
                  searchPlaceholder="搜索 Codex 高亮主题..."
                  searchable
                  value={settings.codeThemeIds[variant]}
                  variant="theme"
                  width={340}
                  onChange={value => updateCodeTheme(variant, value)}
                />
              }
            />
          ))}
          <SettingsRow
            title="主题预览"
            description={`${resolvedVariant === 'dark' ? 'Codex Dark' : 'Codex Light'} · ${
              settings.codeThemeIds[resolvedVariant] === 'auto'
                ? '自动高亮'
                : settings.codeThemeIds[resolvedVariant]
            }`}
            control={
              <div className="appearance-shiki-code-preview">
                <CodeBlock
                  ariaLabel="当前 Codex 高亮主题预览"
                  code={'const codexTheme = "ready"'}
                  language="typescript"
                />
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection title="文字与表面">
          <SettingsRow
            title="UI 字号"
            control={
              <NumberInput
                max={20}
                min={11}
                value={settings.fontSizes.ui}
                onChange={ui => updateFontSizes({ ui })}
              />
            }
          />
          <SettingsRow
            title="代码字号"
            control={
              <NumberInput
                max={20}
                min={10}
                value={settings.fontSizes.code}
                onChange={code => updateFontSizes({ code })}
              />
            }
          />
          <SettingsRow
            autoSave
            title="弹层玻璃效果"
            description="为弹窗和下拉框启用半透明模糊背景"
            control={
              <ToggleSwitch
                checked={settings.glassmorphismEnabled}
                onChange={glassmorphismEnabled =>
                  updateThemeSettings({ glassmorphismEnabled })
                }
              />
            }
          />
        </SettingsSection>

        <SettingsSection title="交互">
          <SettingsRow
            autoSave
            title="使用指针光标"
            description="悬停交互元素时切换为指针光标"
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
            description="减少动画效果或匹配系统设置"
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
            autoSave
            title="差异标记"
            description="使用彩色背景，或在每个更改行上显示 + / - 符号"
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
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
