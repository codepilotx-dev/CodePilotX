import React, { useState } from 'react'
import { Laptop, Moon, Sun } from 'lucide-react'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SegmentedControl } from './SegmentedControl.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { ColorPickerControl } from './ColorPickerControl.js'

// --- Custom Components ---

type ThemeMode = 'light' | 'dark' | 'system'

const THEME_MODE_OPTIONS: Array<{
  value: ThemeMode
  label: string
  icon: React.ReactNode
}> = [
  { value: 'light', label: '浅色', icon: <Sun size={24} /> },
  { value: 'dark', label: '深色', icon: <Moon size={24} /> },
  { value: 'system', label: '系统', icon: <Laptop size={24} /> },
]

function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="appearance-slider-wrap">
      <input 
        type="range" 
        min="0" 
        max="100" 
        value={value} 
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="appearance-slider"
      />
      <span className="appearance-slider-value">{value}</span>
    </div>
  )
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="appearance-number-wrap">
      <input 
        type="number" 
        value={value} 
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="appearance-number-input"
      />
      <span className="appearance-number-unit">px</span>
    </div>
  )
}

function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input 
      type="text" 
      value={value} 
      onChange={e => onChange(e.target.value)}
      className="appearance-text-input"
    />
  )
}

// --- Main Component ---

export function AppearanceSettings() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')
  
  // States
  const [accentColor, setAccentColor] = useState('#0169cc')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [fgColor, setFgColor] = useState('#0d0d0d')
  const [uiFont, setUiFont] = useState('Inter')
  const [codeFont, setCodeFont] = useState('JetBrains Mono SemiB')
  const [transparentSidebar, setTransparentSidebar] = useState(true)
  const [contrast, setContrast] = useState(40)
  const [themeDropdown, setThemeDropdown] = useState('codex')
  
  const [usePointer, setUsePointer] = useState(true)
  const [reduceMotion, setReduceMotion] = useState<'system'|'on'|'off'>('system')
  const [uiFontSize, setUiFontSize] = useState(14)
  const [codeFontSize, setCodeFontSize] = useState(12)
  const [diffMarker, setDiffMarker] = useState<'color'|'+/-'>('color')
  const [pet, setPet] = useState('codex')

  const code1 = [
    { key: 'surface', value: '"sidebar"' },
    { key: 'accent', value: '"#2563eb"' },
    { key: 'contrast', value: '42' },
  ]
  const code2 = [
    { key: 'surface', value: '"sidebar-elevated"' },
    { key: 'accent', value: '"#0ea5e9"' },
    { key: 'contrast', value: '68' },
  ]

  const leftCode = code1
  const rightCode = code2

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">外观</h2>

        {/* 1) 顶部代码对比预览区 */}
        <section className="appearance-theme-preview">
          <div className="appearance-mode-header">
            <div className="appearance-mode-copy">
              <h2 className="appearance-mode-title">主题</h2>
              <p className="appearance-mode-desc">使用浅色、深色，或匹配系统设置</p>
            </div>
            <div className="appearance-mode-toggle" role="tablist" aria-label="主题模式">
              {THEME_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={themeMode === option.value}
                  className={`appearance-mode-option ${themeMode === option.value ? 'active' : ''}`}
                  onClick={() => setThemeMode(option.value)}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="appearance-preview">
            <div className="appearance-preview-pane appearance-preview-red">
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
              {leftCode.map((line, i) => (
                <div key={line.key} className="appearance-preview-line appearance-preview-line-highlight">
                  <div className="appearance-preview-lineno">{i + 2}</div>
                  <div className="appearance-preview-code">
                    <span className="appearance-syntax-prop">{line.key}</span>
                    <span className="appearance-syntax-punct">: </span>
                    <span className={line.key === 'contrast' ? 'appearance-syntax-number' : 'appearance-syntax-string'}>
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
            
            <div className="appearance-preview-pane appearance-preview-green">
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
              {rightCode.map((line, i) => (
                <div key={line.key} className="appearance-preview-line appearance-preview-line-highlight">
                  <div className="appearance-preview-lineno">{i + 2}</div>
                  <div className="appearance-preview-code">
                    <span className="appearance-syntax-prop">{line.key}</span>
                    <span className="appearance-syntax-punct">: </span>
                    <span className={line.key === 'contrast' ? 'appearance-syntax-number' : 'appearance-syntax-string'}>
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
          </div>
        </section>

        {/* 2) 中部: 主题配置 section */}
        <section className="settings-section">
          <div className="appearance-theme-header">
            <h3 className="settings-section-title">浅色主题</h3>
            <div className="appearance-theme-actions">
              <button type="button" className="appearance-btn-import">导入</button>
              <button type="button" className="appearance-btn-copy">复制主题</button>
              <SettingsDropdown
                value={themeDropdown}
                options={[{ value: 'codex', label: 'Aa Codex' }]}
                onChange={setThemeDropdown}
              />
            </div>
          </div>
          
          <div className="settings-card">
            <SettingsRow
              title="强调色"
              control={
                <ColorPickerControl
                  ariaLabel="寮鸿皟鑹"
                  value={accentColor}
                  onChange={setAccentColor}
                />
              }
            />
            <SettingsRow
              title="背景"
              control={
                <ColorPickerControl
                  ariaLabel="鑳屾櫙"
                  value={bgColor}
                  onChange={setBgColor}
                />
              }
            />
            <SettingsRow
              title="前景"
              control={
                <ColorPickerControl
                  ariaLabel="鍓嶆櫙"
                  value={fgColor}
                  onChange={setFgColor}
                />
              }
            />
            <SettingsRow
              title="UI 字体"
              control={<TextInput value={uiFont} onChange={setUiFont} />}
            />
            <SettingsRow
              title="代码字体"
              control={<TextInput value={codeFont} onChange={setCodeFont} />}
            />
            <SettingsRow
              title="半透明侧边栏"
              control={<ToggleSwitch checked={transparentSidebar} onChange={setTransparentSidebar} />}
            />
            <SettingsRow
              title="对比度"
              control={<Slider value={contrast} onChange={setContrast} />}
            />
          </div>
        </section>

        {/* 3) 下部: 其他外观设置 */}
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
                  { value: 'off', label: '关闭' }
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
            title="代码字体大小"
            description="调整聊天和差异视图中代码使用的基准字号"
            control={<NumberInput value={codeFontSize} onChange={setCodeFontSize} />}
          />
          <SettingsRow
            title="差异标记"
            description="使用彩色条和背景，或在每个更改行上显示 '+' 和 '-' 符号"
            control={
              <SegmentedControl
                value={diffMarker}
                options={[
                  { value: 'color', label: '颜色' },
                  { value: '+/-', label: '+/-' }
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
                  { value: 'off', label: '关闭' }
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
