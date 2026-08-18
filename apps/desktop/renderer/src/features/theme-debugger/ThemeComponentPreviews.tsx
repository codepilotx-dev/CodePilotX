import React from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sliders,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { Input } from '../../components/ui/Input.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SegmentedControl } from '../settings/SegmentedControl.js'
import { ChipButton } from '../../components/ui/ChipButton.js'
import { MetaChip } from '../../components/ui/MetaChip.js'

export function DropdownPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Dropdown 实时预览</h4>
      <div className="theme-token-debugger__preview-triggers">
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">常态 Trigger</span>
          <button className="settings-dropdown-trigger" data-theme-component="dropdown-trigger" type="button">
            <span className="settings-dropdown-trigger-text">模型选择 (Claude 3.5 Sonnet)</span>
            <ChevronDown aria-hidden="true" className="settings-dropdown-trigger-icon" size={14} />
          </button>
        </div>
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">展开 Trigger</span>
          <button className="settings-dropdown-trigger" data-state="open" data-theme-component="dropdown-trigger" type="button">
            <span className="settings-dropdown-trigger-text">展开状态 (Open)</span>
            <ChevronDown aria-hidden="true" className="settings-dropdown-trigger-icon" size={14} />
          </button>
        </div>
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">禁用 Trigger</span>
          <button className="settings-dropdown-trigger" data-theme-component="dropdown-trigger" disabled type="button">
            <span className="settings-dropdown-trigger-text">禁用状态 (Disabled)</span>
            <ChevronDown aria-hidden="true" className="settings-dropdown-trigger-icon" size={14} />
          </button>
        </div>
      </div>

      <div className="theme-token-debugger__preview-subitem">
        <span className="theme-token-debugger__preview-label">菜单表面 (Menu Surface)</span>
        <div className="theme-token-debugger__preview-surface popover-surface" data-theme-component="dropdown-surface">
          <button className="settings-dropdown-item" type="button">
            <div className="settings-dropdown-item-inner">
              <div className="settings-dropdown-item-copy">
                <span className="settings-dropdown-item-label">普通菜单项</span>
              </div>
            </div>
          </button>
          <button className="settings-dropdown-item" data-highlighted type="button">
            <div className="settings-dropdown-item-inner">
              <div className="settings-dropdown-item-copy">
                <span className="settings-dropdown-item-label">悬停项 (Hover)</span>
              </div>
            </div>
          </button>
          <button aria-selected="true" className="settings-dropdown-item" type="button">
            <div className="settings-dropdown-item-inner">
              <div className="settings-dropdown-item-copy">
                <span className="settings-dropdown-item-label">选中项 (Selected)</span>
              </div>
            </div>
          </button>
          <button className="settings-dropdown-item" data-pressed type="button">
            <div className="settings-dropdown-item-inner">
              <div className="settings-dropdown-item-copy">
                <span className="settings-dropdown-item-label">按下项 (Pressed)</span>
              </div>
            </div>
          </button>
          <button className="settings-dropdown-item" disabled type="button">
            <div className="settings-dropdown-item-inner">
              <div className="settings-dropdown-item-copy">
                <span className="settings-dropdown-item-label">禁用项 (Disabled)</span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

export function ButtonPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Button 变体与尺寸预览</h4>
      <div className="theme-token-debugger__preview-section-grid">
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">按钮变体 (Variants)</span>
          <div className="theme-token-debugger__preview-row-flex">
            <Button color="secondary" size="compact" type="button">Secondary</Button>
            <Button color="ghost" size="compact" type="button">Ghost</Button>
            <Button color="outline" size="compact" type="button">Outline</Button>
            <Button color="danger" size="compact" type="button">Danger</Button>
          </div>
        </div>

        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">尺寸阶梯 (Sizes)</span>
          <div className="theme-token-debugger__preview-row-flex">
            <Button color="secondary" size="compact" type="button">Compact (24px)</Button>
            <Button color="secondary" size="toolbar" type="button">Toolbar (28px)</Button>
            <Button color="secondary" size="default" type="button">Default</Button>
            <Button color="secondary" size="large" type="button">Large (36px)</Button>
          </div>
        </div>

        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">图标动作按钮 (IconButton)</span>
          <div className="theme-token-debugger__preview-row-flex">
            <IconButton color="secondary" size="iconSm" title="重置" type="button"><RotateCcw size={14} /></IconButton>
            <IconButton color="secondary" size="toolbar" title="配置" type="button"><Sliders size={15} /></IconButton>
            <IconButton color="secondary" size="composer" title="添加" type="button"><Plus size={16} /></IconButton>
            <IconButton color="secondary" disabled size="iconSm" title="禁用" type="button"><Trash2 size={14} /></IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}

export function InputPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Input & SearchInput 实时预览</h4>
      <div className="theme-token-debugger__preview-section-grid">
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">标准单行输入 (Normal)</span>
          <Input aria-label="标准输入示例" defaultValue="Hello CodePilotX" />
        </div>
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">带占位符 (Placeholder)</span>
          <Input aria-label="占位输入示例" placeholder="输入搜索关键词或指令..." />
        </div>
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">禁用状态 (Disabled)</span>
          <Input aria-label="禁用输入示例" defaultValue="不可编辑的内容" disabled />
        </div>
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">搜索输入框 (SearchInput)</span>
          <div className="popover-search-region" style={{ padding: 0 }}>
            <div className="search-input" style={{ width: '100%' }}>
              <Input aria-label="搜索框预览" placeholder="搜索模型、会话或设置..." />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SwitchSegmentedPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Switch & SegmentedControl 预览</h4>
      <div className="theme-token-debugger__preview-section-grid">
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">开关状态 (ToggleSwitch)</span>
          <div className="theme-token-debugger__preview-row-flex">
            <ToggleSwitch ariaLabel="开关开预览" checked={true} onChange={() => {}} />
            <ToggleSwitch ariaLabel="开关关预览" checked={false} onChange={() => {}} />
            <ToggleSwitch ariaLabel="开关禁用预览" checked={true} disabled onChange={() => {}} />
          </div>
        </div>

        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">分段选择 (SegmentedControl)</span>
          <SegmentedControl
            ariaLabel="分段控件示例"
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            value="dark"
            onChange={() => {}}
          />
        </div>

        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">胶囊按钮 (ChipButton & MetaChip)</span>
          <div className="theme-token-debugger__preview-row-flex">
            <ChipButton title="GPT-4o 模型" type="button">GPT-4o</ChipButton>
            <ChipButton active title="Claude 3.5 Sonnet 模型" type="button">Claude 3.5 Sonnet</ChipButton>
            <MetaChip icon={<Sliders size={13} />} label="Read-only" title="只读模式" />
            <MetaChip icon={<Sliders size={13} />} label="TypeScript" title="代码语言" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function TooltipScrollChipPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Tooltip 气泡与 ScrollArea 滑块</h4>
      <div className="theme-token-debugger__preview-section-grid">
        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">浮层气泡 (Tooltip Surface)</span>
          <div className="tooltip-content popover-item-tooltip" style={{ display: 'inline-block', position: 'static' }}>
            <span>快捷键: <strong>Ctrl + Shift + P</strong> 打开命令面板</span>
          </div>
        </div>

        <div className="theme-token-debugger__preview-subitem">
          <span className="theme-token-debugger__preview-label">滚动容器滑块 (ScrollArea)</span>
          <div style={{ height: '100px', overflowY: 'auto', border: '1px solid var(--color-token-border-light)', borderRadius: '6px', padding: '8px' }}>
            <p style={{ margin: '0 0 6px' }}>第一行测试滚动条</p>
            <p style={{ margin: '0 0 6px' }}>第二行测试滚动条内容</p>
            <p style={{ margin: '0 0 6px' }}>第三行测试滚动条内容</p>
            <p style={{ margin: '0 0 6px' }}>第四行测试滚动条内容</p>
            <p style={{ margin: '0 0 6px' }}>第五行测试滚动条内容</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SurfacesPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>5 层表面体系 (Layer Surfaces) 阶梯预览</h4>
      <div className="theme-token-debugger__surfaces-stack">
        <div className="theme-token-debugger__surface-box" style={{ background: 'var(--layer-underlay-fill)' }}>
          <span>1. Underlay (底衬层 / 侧栏)</span>
          <div className="theme-token-debugger__surface-box" style={{ background: 'var(--layer-canvas-fill)' }}>
            <span>2. Canvas (视口画布层)</span>
            <div className="theme-token-debugger__surface-box" style={{ background: 'var(--layer-panel-fill)' }}>
              <span>3. Panel (工作区面板层)</span>
              <div className="theme-token-debugger__surface-box" style={{ background: 'var(--layer-raised-fill)', boxShadow: 'var(--shadow-raised)' }}>
                <span>4. Raised (悬浮抬升层)</span>
                <div className="theme-token-debugger__surface-box" style={{ background: 'var(--layer-floating-fill)', boxShadow: 'var(--shadow-floating)' }}>
                  <span>5. Floating (顶层浮层 / 弹窗)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ModalPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Modal 对话框浮层预览</h4>
      <div className="permission-modal-backdrop" style={{ position: 'relative', height: '240px', padding: '12px', zIndex: 1 }}>
        <div className="permission-modal" style={{ background: 'var(--modal-surface-background, var(--layer-floating-fill))', border: 'var(--modal-surface-border, var(--layer-edge))', boxShadow: 'var(--modal-surface-shadow, var(--shadow-floating))', borderRadius: 'var(--modal-surface-radius, var(--radius-floating))', padding: '16px', width: '100%', maxWidth: '380px' }}>
          <h5 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--color-token-foreground)' }}>确认执行操作</h5>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--color-token-description-foreground)' }}>
            是否允许在当前工作区运行外部命令？该操作将产生文件修改。
          </p>
          <div className="theme-token-debugger__preview-row-flex" style={{ justifyContent: 'flex-end' }}>
            <Button color="secondary" size="compact" type="button">取消</Button>
            <Button color="secondary" size="compact" type="button">允许执行</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SidebarDockPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Left Sidebar & Right Dock 预览</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', border: '1px solid var(--color-token-border-light)', borderRadius: '8px', overflow: 'hidden' }}>
        {/* Left Sidebar Mock */}
        <div style={{ background: 'var(--sidebar-background, var(--color-token-side-bar-background))', padding: '8px', borderRight: 'var(--sidebar-border, 1px solid var(--color-token-border-light))' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-token-description-foreground)' }}>会话列表</span>
          <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ padding: '4px 6px', borderRadius: 'var(--sidebar-item-radius, var(--radius-row))', background: 'var(--sidebar-item-active-background, var(--color-token-list-active-selection-background))', fontSize: '12px', color: 'var(--color-token-foreground)' }}>
              主功能重构
            </div>
            <div style={{ padding: '4px 6px', borderRadius: 'var(--sidebar-item-radius, var(--radius-row))', fontSize: '12px', color: 'var(--color-token-text-secondary)' }}>
              修复内存泄漏
            </div>
          </div>
        </div>

        {/* Right Dock Mock */}
        <div style={{ background: 'var(--right-dock-background, var(--layer-panel-fill))', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: '36px', borderBottom: '1px solid var(--right-dock-border-color, var(--color-token-border-light))', display: 'flex', alignItems: 'center', padding: '0 8px', gap: '4px' }}>
            <div className="right-dock-tab-wrap active" style={{ height: '24px', fontSize: '11px' }}>
              <span className="right-dock-tab-title">文档计划</span>
            </div>
            <div className="right-dock-tab-wrap" style={{ height: '24px', fontSize: '11px' }}>
              <span className="right-dock-tab-title">集成终端</span>
            </div>
          </div>
          <div style={{ padding: '10px', fontSize: '12px', color: 'var(--color-token-description-foreground)' }}>
            右侧停靠栏内容展示区域 (RightDock Body)
          </div>
        </div>
      </div>
    </div>
  )
}

export function WorkbenchPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Workbench Panel & TabStrip 预览</h4>
      <div style={{ border: '1px solid var(--color-token-border-light)', borderRadius: '8px', overflow: 'hidden', background: 'var(--color-token-panel-background)' }}>
        <div style={{ height: '40px', borderBottom: '1px solid var(--color-token-border-light)', display: 'flex', alignItems: 'center', padding: '0 8px', background: 'var(--layer-panel-fill)', gap: '4px' }}>
          <div style={{ padding: '4px 8px', borderRadius: 'var(--radius-row)', background: 'var(--color-token-list-active-selection-background)', color: 'var(--color-token-foreground)', fontSize: '12px', fontWeight: 500 }}>
            Editor.tsx
          </div>
          <div style={{ padding: '4px 8px', borderRadius: 'var(--radius-row)', color: 'var(--color-token-description-foreground)', fontSize: '12px' }}>
            tokens.scss
          </div>
        </div>
        <div style={{ padding: '16px', background: 'var(--color-token-main-surface-primary)', minHeight: '80px', fontSize: '12px', color: 'var(--color-token-foreground)' }}>
          <code>const codePilotX = 'State-of-the-art AI Workspace';</code>
        </div>
      </div>
    </div>
  )
}

export function MenuBarPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>MenuBar 顶部菜单栏预览</h4>
      <div style={{ height: '36px', background: 'var(--color-token-side-bar-background)', border: '1px solid var(--color-token-border-light)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px' }}>
        <div style={{ display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--color-token-foreground)' }}>
          <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'var(--color-token-menubar-selection-background)' }}>文件 (F)</span>
          <span style={{ padding: '2px 6px' }}>编辑 (E)</span>
          <span style={{ padding: '2px 6px' }}>视图 (V)</span>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--color-token-description-foreground)' }}>CodePilotX - Workspace</span>
      </div>
    </div>
  )
}

export function ComposerPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Composer 消息输入台预览</h4>
      <div style={{ border: '1px solid var(--color-token-border-light)', borderRadius: '12px', padding: '10px', background: 'var(--color-token-input-background)' }}>
        <div style={{ fontSize: '13px', color: 'var(--color-token-foreground)', minHeight: '40px' }}>
          为所有组件增加主题 Token 调试能力...
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', borderTop: '1px solid var(--color-token-border-light)', paddingTop: '6px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <IconButton color="secondary" size="iconSm" title="附加文件" type="button"><Paperclip size={13} /></IconButton>
          </div>
          <Button color="secondary" size="compact" type="button">
            <Send size={13} /> 发送
          </Button>
        </div>
      </div>
    </div>
  )
}

export function TerminalPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Terminal 集成终端与 16 色 ANSI 预览</h4>
      <div style={{ background: 'var(--color-token-terminal-background)', border: '1px solid var(--color-token-terminal-border)', borderRadius: '8px', padding: '12px', fontFamily: 'var(--font-family-mono)', fontSize: '12px', color: 'var(--color-token-terminal-foreground)' }}>
        <div style={{ color: 'var(--color-token-terminal-ansi-green)', marginBottom: '4px' }}>
          ➜ codepilotx-app git:(dev)
        </div>
        <div style={{ marginBottom: '8px' }}>
          $ bun run test
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-token-terminal-ansi-red)' }}>[FAIL 0]</span>
          <span style={{ color: 'var(--color-token-terminal-ansi-green)' }}>[PASS 12]</span>
          <span style={{ color: 'var(--color-token-terminal-ansi-yellow)' }}>[WARN 0]</span>
          <span style={{ color: 'var(--color-token-terminal-ansi-blue)' }}>[INFO]</span>
        </div>
      </div>
    </div>
  )
}

export function ReviewDiffPreview(): React.ReactNode {
  return (
    <div className="theme-token-debugger__preview-card">
      <h4>Review Diff 差异对比预览</h4>
      <div style={{ background: 'var(--color-token-diff-surface)', border: '1px solid var(--color-token-border-light)', borderRadius: '6px', overflow: 'hidden', fontSize: '11px', fontFamily: 'var(--font-family-mono)' }}>
        <div style={{ background: 'var(--color-token-diff-editor-removed-line-background)', padding: '2px 8px', color: 'var(--color-token-foreground)' }}>
          - <span style={{ background: 'var(--color-token-diff-editor-removed-text-background)' }}>const oldMode = 'single-component'</span>
        </div>
        <div style={{ background: 'var(--color-token-diff-editor-inserted-line-background)', padding: '2px 8px', color: 'var(--color-token-foreground)' }}>
          + <span style={{ background: 'var(--color-token-diff-editor-inserted-text-background)' }}>const newMode = 'universal-multi-component'</span>
        </div>
      </div>
    </div>
  )
}

export function ComponentPreviewHost({ componentId }: { componentId: string }): React.ReactNode {
  switch (componentId) {
    case 'dropdown':
      return <DropdownPreview />
    case 'button':
      return <ButtonPreview />
    case 'input':
      return <InputPreview />
    case 'switch-segmented':
      return <SwitchSegmentedPreview />
    case 'tooltip-scroll-chip':
      return <TooltipScrollChipPreview />
    case 'surfaces':
      return <SurfacesPreview />
    case 'modal':
      return <ModalPreview />
    case 'sidebar-dock':
      return <SidebarDockPreview />
    case 'workbench':
      return <WorkbenchPreview />
    case 'menubar':
      return <MenuBarPreview />
    case 'composer':
      return <ComposerPreview />
    case 'terminal':
      return <TerminalPreview />
    case 'review-diff':
      return <ReviewDiffPreview />
    default:
      return <DropdownPreview />
  }
}
