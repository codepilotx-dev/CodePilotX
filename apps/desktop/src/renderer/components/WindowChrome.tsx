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

  const runFileAction = (action: FileMenuAction): void => {
    setFileMenuOpen(false)
    onFileMenuAction(action)
  }

  const runEditAction = (action: EditMenuAction): void => {
    setEditMenuOpen(false)
    onEditMenuAction(action)
  }

  const runViewAction = (action: ViewMenuAction): void => {
    setViewMenuOpen(false)
    onViewMenuAction(action)
  }

  const runWindowAction = (action: WindowMenuAction): void => {
    setWindowMenuOpen(false)
    onWindowMenuAction(action)
  }

  const runHelpAction = (action: HelpMenuAction): void => {
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
                    event.stopPropagation()
                    setFileMenuOpen(value => !value)
                  }}
                  type="button"
                >
                  文件
                </button>
              }
              onOpenChange={setFileMenuOpen}
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
                切换侧边栏
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+J"
                onClick={() => runViewAction('toggleBottomPanel')}
              >
                切换底部面板
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+`"
                onClick={() => runViewAction('openTerminal')}
              >
                打开终端
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+Shift+E"
                onClick={() => runViewAction('toggleFileTree')}
              >
                切换文件树
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+T"
                onClick={() => runViewAction('openBrowserTab')}
              >
                打开浏览器标签
              </PopoverItem>
              <PopoverItem
                disabled
                meta="Ctrl+R"
                onClick={() => runViewAction('reloadBrowserPage')}
              >
                重新加载浏览器
              </PopoverItem>
              <PopoverItem
                meta="Alt+Ctrl+B"
                onClick={() => runViewAction('toggleSidePanel')}
              >
                切换侧边面板
              </PopoverItem>
              <PopoverItem meta="Ctrl+F" onClick={() => runViewAction('find')}>
                查找
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+Shift+["
                onClick={() => runViewAction('previousChat')}
              >
                上一个聊天
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+Shift+]"
                onClick={() => runViewAction('nextChat')}
              >
                下一个聊天
              </PopoverItem>
              <PopoverItem meta="Ctrl+[" onClick={() => runViewAction('back')}>
                后退
              </PopoverItem>
              <PopoverItem meta="Ctrl+]" onClick={() => runViewAction('forward')}>
                前进
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+Shift+="
                onClick={() => runViewAction('zoomIn')}
              >
                放大
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+-"
                onClick={() => runViewAction('zoomOut')}
              >
                缩小
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+0"
                onClick={() => runViewAction('actualSize')}
              >
                实际大小
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="F11"
                onClick={() => runViewAction('toggleFullScreen')}
              >
                切换全屏
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
                最小化
              </PopoverItem>
              <PopoverItem onClick={() => runWindowAction('zoom')}>
                缩放
              </PopoverItem>
              <PopoverItem
                meta="Ctrl+W"
                onClick={() => runWindowAction('close')}
              >
                关闭
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
                Codex 文档
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('whatsNew')}>
                新特性
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('automations')}>
                自动化
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('localEnvironments')}>
                本地环境
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('worktrees')}>
                工作树
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('skills')}>
                技能
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('modelContextProtocol')}>
                模型上下文协议
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('troubleshooting')}>
                故障排查
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem onClick={() => runHelpAction('sendFeedback')}>
                发送反馈
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('startPerformanceTrace')}>
                启动性能追踪
              </PopoverItem>
              <div className="popover-divider" />
              <PopoverItem
                meta="Ctrl+Shift+/"
                onClick={() => runHelpAction('keyboardShortcuts')}
              >
                键盘快捷键
              </PopoverItem>
              <PopoverItem onClick={() => runHelpAction('aboutCodex')}>
                关于 Codex
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