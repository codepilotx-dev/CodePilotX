import type React from 'react'
import { useRef } from 'react'
import * as Menubar from '@radix-ui/react-menubar'
import type { DesktopEditAction } from '@codepilotx/shared/desktop-edit-ipc'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { IconButton } from '../../components/ui/IconButton.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../components/ui/popoverSizing.js'
import { cx } from '../../utils/cx.js'
import type { EditCommandCapabilities } from '../../components/ui/EditCommandProvider.js'

export type FileMenuAction =
  | 'close'
  | 'newWindow'
  | 'newChat'
  | 'quickChat'
  | 'openFolder'
  | 'openSettings'
  | 'logOut'
  | 'exit'

export type EditMenuAction = DesktopEditAction

export type ViewMenuAction =
  | 'toggleSidebar'
  | 'toggleBottomPanel'
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
  | 'codepilotxDocumentation'
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
  canNavigateBack: boolean
  canNavigateForward: boolean
  onToggleSidebar: () => void
  onSidebarTriggerPointerEnter: () => void
  onSidebarTriggerPointerLeave: () => void
  editMenuCapabilities: EditCommandCapabilities
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onFileMenuAction: (action: FileMenuAction) => void
  onEditMenuAction: (action: EditMenuAction) => void
  onViewMenuAction: (action: ViewMenuAction) => void
  onWindowMenuAction: (action: WindowMenuAction) => void
  onHelpMenuAction: (
    action: HelpMenuAction,
    restoreFocusElement?: HTMLElement | null,
  ) => void
}

type MenuItemProps = {
  children: React.ReactNode
  disabled?: boolean
  shortcut?: React.ReactNode
  onSelect: () => void
}

function MenuItem({
  children,
  disabled,
  shortcut,
  onSelect,
}: MenuItemProps): React.ReactNode {
  return (
    <Menubar.Item
      className="menubar-item"
      disabled={disabled}
      onSelect={event => {
        if (disabled) {
          event.preventDefault()
          return
        }
        onSelect()
      }}
    >
      <span className={cx('menubar-item-label', 'u-min-w-0', 'u-truncate')}>{children}</span>
      <span className="menubar-item-trailing">
        {shortcut ? (
          <span
            className={cx(
              'menubar-shortcut',
              disabled ? 'u-text-disabled' : 'u-text-meta',
              'u-type-caption',
              'u-nowrap',
            )}
          >
            {shortcut}
          </span>
        ) : null}
      </span>
    </Menubar.Item>
  )
}

function MenuSeparator(): React.ReactNode {
  return <Menubar.Separator className="menubar-separator" />
}

type AppMenuProps = {
  children: React.ReactNode
  contentClassName?: string
  label: string
  triggerRef?: React.Ref<HTMLButtonElement>
  value: string
} & PopoverSizingProps

function AppMenu({
  children,
  contentClassName = '',
  label,
  triggerRef,
  value,
  width,
  maxWidth,
}: AppMenuProps): React.ReactNode {
  return (
    <Menubar.Menu value={value}>
      <Menubar.Trigger className="menubar-trigger" ref={triggerRef}>
        {label}
      </Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content
          align="start"
          className={['popover-surface', 'menubar-content', contentClassName].join(' ')}
          data-edit-command-preserve-target
          sideOffset={4}
          style={buildPopoverSizingStyle({ width, maxWidth })}
        >
          {children}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  )
}

export function MenuBar({
  sidebarCollapsed,
  isMaximized,
  canNavigateBack,
  canNavigateForward,
  onToggleSidebar,
  onSidebarTriggerPointerEnter,
  onSidebarTriggerPointerLeave,
  editMenuCapabilities,
  onMinimize,
  onToggleMaximize,
  onClose,
  onFileMenuAction,
  onEditMenuAction,
  onViewMenuAction,
  onWindowMenuAction,
  onHelpMenuAction,
}: Props): React.ReactNode {
  const helpMenuTriggerRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="app-menubar" data-edit-command-preserve-target>
      <div className="menubar-titlebar">
        <div className="menubar-left">
          <IconButton
            data-app-shell-sidebar-trigger
            onClick={onToggleSidebar}
            onPointerEnter={onSidebarTriggerPointerEnter}
            onPointerLeave={onSidebarTriggerPointerLeave}
            size="sm"
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            variant="toolbar"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            ) : (
              <PanelLeftClose size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            )}
          </IconButton>
          <IconButton
            disabled={!canNavigateBack}
            onClick={() => onViewMenuAction('back')}
            size="sm"
            title="后退"
            variant="toolbar"
          >
            <ChevronLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            disabled={!canNavigateForward}
            onClick={() => onViewMenuAction('forward')}
            size="sm"
            title="前进"
            variant="toolbar"
          >
            <ChevronRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>

          <Menubar.Root
            aria-label="应用菜单"
            className="menubar-root"
            loop
          >
            <AppMenu label="文件" value="file" width={240}>
              <MenuItem shortcut="Ctrl+W" onSelect={() => onFileMenuAction('close')}>
                关闭
              </MenuItem>
              <MenuItem
                shortcut="Ctrl+Shift+N"
                onSelect={() => onFileMenuAction('newWindow')}
              >
                新建窗口
              </MenuItem>
              <MenuItem shortcut="Ctrl+N" onSelect={() => onFileMenuAction('newChat')}>
                新建聊天
              </MenuItem>
              <MenuItem
                shortcut="Alt+Ctrl+N"
                onSelect={() => onFileMenuAction('quickChat')}
              >
                快速聊天
              </MenuItem>
              <MenuItem shortcut="Ctrl+O" onSelect={() => onFileMenuAction('openFolder')}>
                打开文件夹...
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                shortcut="Ctrl+逗号"
                onSelect={() => onFileMenuAction('openSettings')}
              >
                设置...
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => onFileMenuAction('exit')}>
                退出应用
              </MenuItem>
            </AppMenu>

            <AppMenu label="编辑" value="edit" width={240}>
              <MenuItem
                disabled={!editMenuCapabilities.undo}
                shortcut="Ctrl+Z"
                onSelect={() => onEditMenuAction('undo')}
              >
                撤销
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.redo}
                shortcut="Ctrl+Y"
                onSelect={() => onEditMenuAction('redo')}
              >
                重做
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                disabled={!editMenuCapabilities.cut}
                shortcut="Ctrl+X"
                onSelect={() => onEditMenuAction('cut')}
              >
                剪切
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.copy}
                shortcut="Ctrl+C"
                onSelect={() => onEditMenuAction('copy')}
              >
                复制
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.paste}
                shortcut="Ctrl+V"
                onSelect={() => onEditMenuAction('paste')}
              >
                粘贴
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.delete}
                shortcut="Delete"
                onSelect={() => onEditMenuAction('delete')}
              >
                删除
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                disabled={!editMenuCapabilities.selectAll}
                shortcut="Ctrl+A"
                onSelect={() => onEditMenuAction('selectAll')}
              >
                全选
              </MenuItem>
            </AppMenu>

            <AppMenu label="查看" value="view" width={260}>
              <MenuItem
                shortcut="Ctrl+B"
                onSelect={() => onViewMenuAction('toggleSidebar')}
              >
                切换侧边栏
              </MenuItem>
              <MenuItem
                shortcut="Ctrl+J"
                onSelect={() => onViewMenuAction('toggleSidePanel')}
              >
                切换右侧面板
              </MenuItem>
              <MenuItem
                onSelect={() => onViewMenuAction('toggleBottomPanel')}
              >
                切换底部面板
              </MenuItem>
              <MenuItem
                shortcut="Ctrl+Shift+E"
                onSelect={() => onViewMenuAction('toggleFileTree')}
              >
                切换文件树
              </MenuItem>
              <MenuItem
                shortcut="Ctrl+T"
                onSelect={() => onViewMenuAction('openBrowserTab')}
              >
                打开浏览器标签
              </MenuItem>
              <MenuItem
                disabled
                shortcut="Ctrl+R"
                onSelect={() => onViewMenuAction('reloadBrowserPage')}
              >
                重新加载浏览器
              </MenuItem>
              <MenuItem shortcut="Ctrl+F" onSelect={() => onViewMenuAction('find')}>
                查找
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                shortcut="Ctrl+Shift+["
                onSelect={() => onViewMenuAction('previousChat')}
              >
                上一个聊天
              </MenuItem>
              <MenuItem
                shortcut="Ctrl+Shift+]"
                onSelect={() => onViewMenuAction('nextChat')}
              >
                下一个聊天
              </MenuItem>
              <MenuItem
                disabled={!canNavigateBack}
                shortcut="Ctrl+["
                onSelect={() => onViewMenuAction('back')}
              >
                后退
              </MenuItem>
              <MenuItem
                disabled={!canNavigateForward}
                shortcut="Ctrl+]"
                onSelect={() => onViewMenuAction('forward')}
              >
                前进
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                shortcut="Ctrl+Shift+="
                onSelect={() => onViewMenuAction('zoomIn')}
              >
                放大
              </MenuItem>
              <MenuItem shortcut="Ctrl+-" onSelect={() => onViewMenuAction('zoomOut')}>
                缩小
              </MenuItem>
              <MenuItem shortcut="Ctrl+0" onSelect={() => onViewMenuAction('actualSize')}>
                实际大小
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                shortcut="F11"
                onSelect={() => onViewMenuAction('toggleFullScreen')}
              >
                切换全屏
              </MenuItem>
            </AppMenu>

            <AppMenu
              contentClassName="menubar-content-window"
              label="窗口"
              value="window"
              width={240}
            >
              <MenuItem
                shortcut="Ctrl+M"
                onSelect={() => onWindowMenuAction('minimize')}
              >
                最小化
              </MenuItem>
              <MenuItem onSelect={() => onWindowMenuAction('zoom')}>
                缩放
              </MenuItem>
              <MenuItem shortcut="Ctrl+W" onSelect={() => onWindowMenuAction('close')}>
                关闭
              </MenuItem>
            </AppMenu>

            <AppMenu
              contentClassName="menubar-content-help"
              label="帮助"
              triggerRef={helpMenuTriggerRef}
              value="help"
              width={260}
            >
              <MenuItem onSelect={() => onHelpMenuAction('codepilotxDocumentation')}>
                CodePilotX 文档
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  onHelpMenuAction('whatsNew', helpMenuTriggerRef.current)
                }
              >
                新特性
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('automations')}>
                自动化
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('localEnvironments')}>
                本地环境
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('worktrees')}>
                工作树
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('skills')}>
                技能
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('modelContextProtocol')}>
                模型上下文协议
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('troubleshooting')}>
                故障排查
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => onHelpMenuAction('sendFeedback')}>
                发送反馈
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('startPerformanceTrace')}>
                启动性能追踪
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                shortcut="Ctrl+Shift+/"
                onSelect={() => onHelpMenuAction('keyboardShortcuts')}
              >
                键盘快捷键
              </MenuItem>
              <MenuItem onSelect={() => onHelpMenuAction('aboutCodex')}>
                关于 CodePilotX
              </MenuItem>
            </AppMenu>
          </Menubar.Root>
        </div>

        <div className="window-controls">
          <IconButton
            className="window-control-button"
            onClick={onMinimize}
            title="最小化"
            variant="plain"
          >
            <Minus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            className="window-control-button"
            onClick={onToggleMaximize}
            title={isMaximized ? '还原' : '最大化'}
            variant="plain"
          >
            {isMaximized ? (
              <Copy
                className="window-restore-icon"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            ) : (
              <Square size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            )}
          </IconButton>
          <IconButton
            className="window-control-button close"
            onClick={onClose}
            title="关闭"
            variant="plain"
          >
            <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
