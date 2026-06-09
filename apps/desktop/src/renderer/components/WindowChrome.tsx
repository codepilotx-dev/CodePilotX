import type React from 'react'
import { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-react'
import { IconButton } from './ui/IconButton.js'
import { PopoverMenu } from './ui/PopoverMenu.js'
import { PopoverItem } from './ui/PopoverItem.js'

export type FileMenuAction =
  | 'close'
  | 'newWindow'
  | 'newChat'
  | 'quickChat'
  | 'openFolder'
  | 'openSettings'
  | 'logOut'
  | 'exit'

export type EditMenuAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'delete'
  | 'selectAll'

export type ViewMenuAction =
  | 'toggleSidebar'
  | 'toggleBottomPanel'
  | 'openTerminal'
  | 'toggleFileTree'
  | 'openBrowserTab'
  | 'reloadBrowserPage'
  | 'toggleSidePanel'
  | 'find'
  | 'previousChat'
  | 'nextChat'
  | 'back'
  | 'forward'
  | 'zoomIn'
  | 'zoomOut'
  | 'actualSize'
  | 'toggleFullScreen'

export type WindowMenuAction = 'minimize' | 'zoom' | 'close'

export type HelpMenuAction =
  | 'codexDocumentation'
  | 'whatsNew'
  | 'automations'
  | 'localEnvironments'
  | 'worktrees'
  | 'skills'
  | 'modelContextProtocol'
  | 'troubleshooting'
  | 'sendFeedback'
  | 'startPerformanceTrace'
  | 'keyboardShortcuts'
  | 'aboutCodex'

type Props = {
  sidebarCollapsed: boolean
  isMaximized: boolean
  onToggleSidebar: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onFileMenuAction: (action: FileMenuAction) => void
  onEditMenuAction: (action: EditMenuAction) => void
  onViewMenuAction: (action: ViewMenuAction) => void
  onWindowMenuAction: (action: WindowMenuAction) => void
  onHelpMenuAction: (action: HelpMenuAction) => void
}

function debugLog(message: string, payload?: unknown): void {
  const line = `[window-chrome] ${message}`
  if (payload === undefined) {
    console.log(line)
  } else {
    console.log(line, payload)
  }
  if (
    typeof window !== 'undefined' &&
    window.desktopApi &&
    typeof window.desktopApi.logRenderer === 'function'
  ) {
    try {
      void window.desktopApi.logRenderer(line, payload)
    } catch {}
  }
}

export function WindowChrome({
  sidebarCollapsed,
  isMaximized,
  onToggleSidebar,
  onMinimize,
  onToggleMaximize,
  onClose,
  onFileMenuAction,
  onEditMenuAction,
  onViewMenuAction,
  onWindowMenuAction,
  onHelpMenuAction,
}: Props): React.ReactNode {
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [editMenuOpen, setEditMenuOpen] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [windowMenuOpen, setWindowMenuOpen] = useState(false)
  const [helpMenuOpen, setHelpMenuOpen] = useState(false)

  debugLog('render', {
    fileMenuOpen,
    editMenuOpen,
    viewMenuOpen,
    windowMenuOpen,
    helpMenuOpen,
  })

  const runFileAction = (action: FileMenuAction): void => {
    debugLog('runFileAction', action)
    setFileMenuOpen(false)
    onFileMenuAction(action)
  }

  const runEditAction = (action: EditMenuAction): void => {
    debugLog('runEditAction', action)
    setEditMenuOpen(false)
    onEditMenuAction(action)
  }

  const runViewAction = (action: ViewMenuAction): void => {
    debugLog('runViewAction', action)
    setViewMenuOpen(false)
    onViewMenuAction(action)
  }

  const runWindowAction = (action: WindowMenuAction): void => {
    debugLog('runWindowAction', action)
    setWindowMenuOpen(false)
    onWindowMenuAction(action)
  }

  const runHelpAction = (action: HelpMenuAction): void => {
    debugLog('runHelpAction', action)
    setHelpMenuOpen(false)
    onHelpMenuAction(action)
  }

  return (
    <div className="window-chrome">
      <div className="window-titlebar">
        <div className="window-titlebar-left">
          <IconButton
            className="window-toolbar-icon"
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.8} />
            )}
          </IconButton>
          <IconButton className="window-toolbar-icon" title="后退">
            <ChevronLeft size={16} strokeWidth={1.8} />
          </IconButton>
          <IconButton className="window-toolbar-icon" title="前进">
            <ChevronRight size={16} strokeWidth={1.8} />
          </IconButton>

          <nav className="window-menu" aria-label="应用菜单">
            <PopoverMenu
              className="popover-menu-file"
              open={fileMenuOpen}
              trigger={
                <button
                  className={[
                    'window-menu-item',
                    fileMenuOpen ? 'active' : '',
                  ].join(' ')}
                  onPointerDown={event => {
                    if (event.button !== 0) return
                    debugLog('trigger pointerdown', {
                      currentOpen: fileMenuOpen,
                    })
                    event.stopPropagation()
                    setFileMenuOpen(value => !value)
                  }}
                  type="button"
                >
                  文件
                </button>
              }
              onOpenChange={next => {
                debugLog('onOpenChange', next)
                setFileMenuOpen(next)
              }}
            >
              <PopoverItem meta="Ctrl+W" onClick={() => runFileAction('close')}>
                关闭
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+Shift+N"
                onClick={() => runFileAction('newWindow')}
              >
                新建窗口
              </PopoverItem>
              <PopoverItem meta="Ctrl+N" onClick={() => runFileAction('newChat')}>
                新建聊天
              </PopoverItem>
              <PopoverItem
                meta="Alt+Ctrl+N"
                onClick={() => runFileAction('quickChat')}
              >
                快速聊天
              </PopoverItem>
              <PopoverItem meta="Ctrl+O" onClick={() => runFileAction('openFolder')}>
                打开文件夹...
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+逗号"
                onClick={() => runFileAction('openSettings')}
              >
                设置...
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem onClick={() => runFileAction('exit')}>
                退出应用
              </PopoverItem>
            </PopoverMenu>
            <PopoverMenu
              className="popover-menu-edit"
              open={editMenuOpen}
              trigger={
                <button
                  className={[
                    'window-menu-item',
                    editMenuOpen ? 'active' : '',
                  ].join(' ')}
                  onPointerDown={event => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    setEditMenuOpen(value => !value)
                  }}
                  type="button"
                >
                  编辑
                </button>
              }
              onOpenChange={setEditMenuOpen}
            >
              <PopoverItem meta="Ctrl+Z" onClick={() => runEditAction('undo')}>
                撤销
              </PopoverItem>
              <PopoverItem meta="Ctrl+Y" onClick={() => runEditAction('redo')}>
                重做
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem meta="Ctrl+X" onClick={() => runEditAction('cut')}>
                剪切
              </PopoverItem>
              <PopoverItem meta="Ctrl+C" onClick={() => runEditAction('copy')}>
                复制
              </PopoverItem>
              <PopoverItem meta="Ctrl+V" onClick={() => runEditAction('paste')}>
                粘贴
              </PopoverItem>
              <PopoverItem meta="Delete" onClick={() => runEditAction('delete')}>
                删除
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+A"
                onClick={() => runEditAction('selectAll')}
              >
                全选
              </PopoverItem>
            </PopoverMenu>
            <PopoverMenu
              className="popover-menu-view"
              open={viewMenuOpen}
              trigger={
                <button
                  className={[
                    'window-menu-item',
                    viewMenuOpen ? 'active' : '',
                  ].join(' ')}
                  onPointerDown={event => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    setViewMenuOpen(value => !value)
                  }}
                  type="button"
                >
                  查看
                </button>
              }
              onOpenChange={setViewMenuOpen}
            >
              <PopoverItem
                meta="Ctrl+B"
                onClick={() => runViewAction('toggleSidebar')}
              >
                Toggle Sidebar
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+J"
                onClick={() => runViewAction('toggleBottomPanel')}
              >
                Toggle Bottom Panel
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+`"
                onClick={() => runViewAction('openTerminal')}
              >
                Open Terminal
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+Shift+E"
                onClick={() => runViewAction('toggleFileTree')}
              >
                Toggle File Tree
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+T"
                onClick={() => runViewAction('openBrowserTab')}
              >
                Open Browser Tab
              </PopoverItem>
              <PopoverItem
                disabled
                meta="Ctrl+R"
                onClick={() => runViewAction('reloadBrowserPage')}
              >
                Reload Browser Page
              </PopoverItem>
              <PopoverItem
                meta="Alt+Ctrl+B"
                onClick={() => runViewAction('toggleSidePanel')}
              >
                Toggle Side Panel
              </PopoverItem>
              <PopoverItem meta="Ctrl+F" onClick={() => runViewAction('find')}>
                Find
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+Shift+["
                onClick={() => runViewAction('previousChat')}
              >
                Previous Chat
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+Shift+]"
                onClick={() => runViewAction('nextChat')}
              >
                Next Chat
              </PopoverItem>
              <PopoverItem meta="Ctrl+[" onClick={() => runViewAction('back')}>
                Back
              </PopoverItem>
              <PopoverItem meta="Ctrl+]" onClick={() => runViewAction('forward')}>
                Forward
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+Shift+="
                onClick={() => runViewAction('zoomIn')}
              >
                Zoom In
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+-"
                onClick={() => runViewAction('zoomOut')}
              >
                Zoom Out
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+0"
                onClick={() => runViewAction('actualSize')}
              >
                Actual Size
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="F11"
                onClick={() => runViewAction('toggleFullScreen')}
              >
                Toggle Full Screen
              </PopoverItem>
            </PopoverMenu>
            <PopoverMenu
              className="popover-menu-window"
              open={windowMenuOpen}
              trigger={
                <button
                  className={[
                    'window-menu-item',
                    windowMenuOpen ? 'active' : '',
                  ].join(' ')}
                  onPointerDown={event => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    setWindowMenuOpen(value => !value)
                  }}
                  type="button"
                >
                  窗口
                </button>
              }
              onOpenChange={setWindowMenuOpen}
            >
              <PopoverItem
                meta="Ctrl+M"
                onClick={() => runWindowAction('minimize')}
              >
                Minimize
              </PopoverItem>
              <PopoverItem
                onClick={() => runWindowAction('zoom')}
              >
                Zoom
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+W"
                onClick={() => runWindowAction('close')}
              >
                Close
              </PopoverItem>
            </PopoverMenu>
            <PopoverMenu
              className="popover-menu-help"
              open={helpMenuOpen}
              trigger={
                <button
                  className={[
                    'window-menu-item',
                    helpMenuOpen ? 'active' : '',
                  ].join(' ')}
                  onPointerDown={event => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    setHelpMenuOpen(value => !value)
                  }}
                  type="button"
                >
                  帮助
                </button>
              }
              onOpenChange={setHelpMenuOpen}
            >
              <PopoverItem
                onClick={() => runHelpAction('codexDocumentation')}
              >
                Codex Documentation
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('whatsNew')}>
                What's new
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('automations')}>
                Automations
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('localEnvironments')}>
                Local Environments
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('worktrees')}>
                Worktrees
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('skills')}>
                Skills
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('modelContextProtocol')}>
                Model Context Protocol
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('troubleshooting')}>
                Troubleshooting
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem onClick={() => runHelpAction('sendFeedback')}>
                Send Feedback
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('startPerformanceTrace')}>
                Start Performance Trace
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+Shift+/"
                onClick={() => runHelpAction('keyboardShortcuts')}
              >
                Keyboard Shortcuts
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('aboutCodex')}>
                About Codex
              </PopoverItem>
            </PopoverMenu>
          </nav>
        </div>

        <div className="window-controls">
          <IconButton
            className="window-control-button"
            onClick={onMinimize}
            title="最小化"
          >
            <Minus size={14} strokeWidth={2} />
          </IconButton>
          <IconButton
            className="window-control-button"
            onClick={onToggleMaximize}
            title={isMaximized ? '还原' : '最大化'}
          >
            <Square size={13} strokeWidth={1.9} />
          </IconButton>
          <IconButton
            className="window-control-button close"
            onClick={onClose}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
