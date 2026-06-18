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

function logChromeDebug(
  event: string,
  details?: Record<string, unknown>,
): void {
  console.log('[desktop-window-chrome-debug]', event, details ?? {})
}

function getPointerDebugDetails(
  event: React.PointerEvent<HTMLElement>,
): Record<string, unknown> {
  return {
    button: event.button,
    pointerType: event.pointerType,
    target: describeEventTarget(event.target),
  }
}

function describeEventTarget(target: EventTarget): string {
  if (!(target instanceof HTMLElement)) return target.constructor.name
  const parts = [target.tagName.toLowerCase()]
  if (target.id) {
    parts.push(`#${target.id}`)
  }
  if (target.className && typeof target.className === 'string') {
    parts.push(`.${target.className.trim().replace(/\s+/g, '.')}`)
  }
  return parts.join('')
}

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

export type WindowMenuAction = 'minimize' | 'zoom' | 'close' | 'debug'

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
    logChromeDebug('menu_action_select', { menu: 'file', action })
    setFileMenuOpen(false)
    onFileMenuAction(action)
  }

  const runEditAction = (action: EditMenuAction): void => {
    logChromeDebug('menu_action_select', { menu: 'edit', action })
    setEditMenuOpen(false)
    onEditMenuAction(action)
  }

  const runViewAction = (action: ViewMenuAction): void => {
    logChromeDebug('menu_action_select', { menu: 'view', action })
    setViewMenuOpen(false)
    onViewMenuAction(action)
  }

  const runWindowAction = (action: WindowMenuAction): void => {
    logChromeDebug('menu_action_select', { menu: 'window', action })
    setWindowMenuOpen(false)
    onWindowMenuAction(action)
  }

  const runHelpAction = (action: HelpMenuAction): void => {
    logChromeDebug('menu_action_select', { menu: 'help', action })
    setHelpMenuOpen(false)
    onHelpMenuAction(action)
  }

  const logMenuTriggerPointerDown = (
    menu: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    logChromeDebug('menu_trigger_pointer_down', {
      menu,
      ...getPointerDebugDetails(event),
    })
  }

  const logMenuTriggerClick = (menu: string): void => {
    logChromeDebug('menu_trigger_click', { menu })
  }

  const logControlPointerDown = (
    control: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    logChromeDebug('control_pointer_down', {
      control,
      ...getPointerDebugDetails(event),
    })
  }

  const logControlClick = (control: string): void => {
    logChromeDebug('control_click', { control })
  }

  return (
    <div className="window-chrome">
      <div className="window-titlebar">
        <div className="window-titlebar-left">
          <IconButton
            className="window-toolbar-icon"
            onClick={() => {
              logControlClick('toggleSidebar')
              onToggleSidebar()
            }}
            onPointerDown={event =>
              logControlPointerDown('toggleSidebar', event)
            }
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.8} />
            )}
          </IconButton>
          <IconButton
            className="window-toolbar-icon"
            onClick={() => logControlClick('back-unhandled')}
            onPointerDown={event => logControlPointerDown('back', event)}
            title="后退"
          >
            <ChevronLeft size={16} strokeWidth={1.8} />
          </IconButton>
          <IconButton
            className="window-toolbar-icon"
            onClick={() => logControlClick('forward-unhandled')}
            onPointerDown={event => logControlPointerDown('forward', event)}
            title="前进"
          >
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
                  onClick={() => logMenuTriggerClick('file')}
                  onPointerDown={event =>
                    logMenuTriggerPointerDown('file', event)
                  }
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
                  onClick={() => logMenuTriggerClick('edit')}
                  onPointerDown={event =>
                    logMenuTriggerPointerDown('edit', event)
                  }
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
                  onClick={() => logMenuTriggerClick('view')}
                  onPointerDown={event =>
                    logMenuTriggerPointerDown('view', event)
                  }
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
                  onClick={() => logMenuTriggerClick('window')}
                  onPointerDown={event =>
                    logMenuTriggerPointerDown('window', event)
                  }
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
              <div className="popover-divider" />
              <PopoverItem onClick={() => runWindowAction('debug')}>
                调试...
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
                  onClick={() => logMenuTriggerClick('help')}
                  onPointerDown={event =>
                    logMenuTriggerPointerDown('help', event)
                  }
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
                CodePilotX 文档
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
                关于 CodePilotX
              </PopoverItem>
            </PopoverMenu>
          </nav>
        </div>

        <div className="window-controls">
          <IconButton
            className="window-control-button"
            onClick={() => {
              logControlClick('minimize')
              onMinimize()
            }}
            onPointerDown={event => logControlPointerDown('minimize', event)}
            title="最小化"
          >
            <Minus size={14} strokeWidth={2} />
          </IconButton>
          <IconButton
            className="window-control-button"
            onClick={() => {
              logControlClick('toggleMaximize')
              onToggleMaximize()
            }}
            onPointerDown={event =>
              logControlPointerDown('toggleMaximize', event)
            }
            title={isMaximized ? '还原' : '最大化'}
          >
            <Square size={13} strokeWidth={1.9} />
          </IconButton>
          <IconButton
            className="window-control-button close"
            onClick={() => {
              logControlClick('close')
              onClose()
            }}
            onPointerDown={event => logControlPointerDown('close', event)}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
