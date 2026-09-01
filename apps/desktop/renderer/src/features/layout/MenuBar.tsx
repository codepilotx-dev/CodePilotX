import type React from 'react'
import { useEffect, useRef, useState } from 'react'
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
import { useEditCommands } from '../../components/ui/EditCommandProvider.js'

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
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onFileMenuAction: (action: FileMenuAction) => void
  onViewMenuAction: (action: ViewMenuAction) => void
  onWindowMenuAction: (action: WindowMenuAction) => void
  onHelpMenuAction: (
    action: HelpMenuAction,
    restoreFocusElement?: HTMLElement | null,
  ) => void
}

export type WindowControlsProps = {
  isMaximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
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
  onRequestClose: () => void
  triggerRef?: React.Ref<HTMLButtonElement>
  value: AppMenuValue
} & PopoverSizingProps

type AppMenuValue = 'file' | 'edit' | 'view' | 'window' | 'help'

const MENU_MNEMONICS: Record<string, AppMenuValue> = {
  f: 'file',
  e: 'edit',
  v: 'view',
  w: 'window',
  h: 'help',
}

function AppMenu({
  children,
  contentClassName = '',
  label,
  onRequestClose,
  triggerRef,
  value,
  width,
  maxWidth,
}: AppMenuProps): React.ReactNode {
  return (
    <Menubar.Menu value={value}>
      <Menubar.Trigger
        data-theme-component="dropdown-trigger"
        className="menubar-trigger"
        onPointerDown={event => {
          if (
            event.currentTarget.dataset.state === 'open'
            && event.button === 0
            && event.ctrlKey === false
          ) {
            event.preventDefault()
            onRequestClose()
          }
        }}
        ref={triggerRef}
      >
        {label}
      </Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content
          data-theme-component="dropdown-surface"
          align="start"
          className={['popover-surface', 'menubar-content', contentClassName].join(' ')}
          collisionPadding={6}
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
  onMinimize,
  onToggleMaximize,
  onClose,
  onFileMenuAction,
  onViewMenuAction,
  onWindowMenuAction,
  onHelpMenuAction,
}: Props): React.ReactNode {
  const {
    activeCapabilities: editMenuCapabilities,
    perform: performEditCommand,
  } = useEditCommands()
  const helpMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuTriggerRefs = useRef<Partial<Record<AppMenuValue, HTMLButtonElement | null>>>({})
  const menuBarFocusedRef = useRef(false)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const ignoreStaleCloseRef = useRef(false)
  const [openMenu, setOpenMenu] = useState<AppMenuValue | ''>('')

  function closeMenu(): void {
    ignoreStaleCloseRef.current = false
    setOpenMenu('')
  }

  function handleMenuValueChange(value: string): void {
    // react-menubar@1.1.18 reports a stale close in the same event turn
    // after switching the controlled Root to another Menu.
    if (!value && ignoreStaleCloseRef.current) return
    ignoreStaleCloseRef.current = Boolean(value)
    setOpenMenu(value as AppMenuValue | '')
    if (value) queueMicrotask(() => (ignoreStaleCloseRef.current = false))
  }

  function rememberFocusSource(): void {
    if (menuBarFocusedRef.current) return
    const active = document.activeElement
    restoreFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null
  }

  function focusMenuBar(): void {
    rememberFocusSource()
    menuBarFocusedRef.current = true
    menuTriggerRefs.current.file?.focus({ preventScroll: true })
  }

  function openMenuByMnemonic(value: AppMenuValue): void {
    rememberFocusSource()
    menuBarFocusedRef.current = true
    setOpenMenu(value)
    menuTriggerRefs.current[value]?.focus({ preventScroll: true })
  }

  function restoreMenuBarFocus(): void {
    const target = restoreFocusRef.current
    menuBarFocusedRef.current = false
    restoreFocusRef.current = null
    if (target && target.isConnected) {
      target.focus({ preventScroll: true })
    } else {
      menuTriggerRefs.current.file?.blur()
    }
  }

  function handleMenuBarKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && openMenu === '' && menuBarFocusedRef.current) {
      event.preventDefault()
      restoreMenuBarFocus()
    }
  }

  function handleMenuBarBlur(event: React.FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    menuBarFocusedRef.current = false
    restoreFocusRef.current = null
  }

  useEffect(() => {
    // Windows 桌面菜单行为：Alt/F10 聚焦菜单栏，Alt+F/E/V/W/H 直接打开对应菜单。
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) return
      if (event.key === 'F10') {
        event.preventDefault()
        focusMenuBar()
        return
      }
      if (event.key === 'Alt') {
        focusMenuBar()
        return
      }
      const mnemonic = MENU_MNEMONICS[event.key.toLocaleLowerCase()]
      if (mnemonic && (event.altKey || menuBarFocusedRef.current)) {
        event.preventDefault()
        event.stopPropagation()
        openMenuByMnemonic(mnemonic)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="app-menubar"
      data-edit-command-preserve-target
      onBlur={handleMenuBarBlur}
      onKeyDown={handleMenuBarKeyDown}
    >
      <div className="menubar-titlebar">
        <div className="menubar-left">
          <IconButton
            data-app-shell-sidebar-trigger
            onClick={onToggleSidebar}
            onPointerEnter={onSidebarTriggerPointerEnter}
            onPointerLeave={onSidebarTriggerPointerLeave}
            color="ghost"
            size="toolbar"
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            ) : (
              <PanelLeftClose size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            )}
          </IconButton>
          <IconButton
            disabled={!canNavigateBack}
            color="ghost"
            onClick={() => onViewMenuAction('back')}
            size="toolbar"
            title="后退"
          >
            <ChevronLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            disabled={!canNavigateForward}
            color="ghost"
            onClick={() => onViewMenuAction('forward')}
            size="toolbar"
            title="前进"
          >
            <ChevronRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>

          <Menubar.Root
            aria-label="应用菜单"
            className="menubar-root"
            loop
            onValueChange={handleMenuValueChange}
            value={openMenu}
          >
            <AppMenu
              label="文件"
              onRequestClose={closeMenu}
              triggerRef={ref => { menuTriggerRefs.current.file = ref }}
              value="file"
              width={240}
            >
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

            <AppMenu
              label="编辑"
              onRequestClose={closeMenu}
              triggerRef={ref => { menuTriggerRefs.current.edit = ref }}
              value="edit"
              width={240}
            >
              <MenuItem
                disabled={!editMenuCapabilities.undo}
                shortcut="Ctrl+Z"
                onSelect={() => void performEditCommand('undo')}
              >
                撤销
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.redo}
                shortcut="Ctrl+Y"
                onSelect={() => void performEditCommand('redo')}
              >
                重做
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                disabled={!editMenuCapabilities.cut}
                shortcut="Ctrl+X"
                onSelect={() => void performEditCommand('cut')}
              >
                剪切
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.copy}
                shortcut="Ctrl+C"
                onSelect={() => void performEditCommand('copy')}
              >
                复制
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.paste}
                shortcut="Ctrl+V"
                onSelect={() => void performEditCommand('paste')}
              >
                粘贴
              </MenuItem>
              <MenuItem
                disabled={!editMenuCapabilities.delete}
                shortcut="Delete"
                onSelect={() => void performEditCommand('delete')}
              >
                删除
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                disabled={!editMenuCapabilities.selectAll}
                shortcut="Ctrl+A"
                onSelect={() => void performEditCommand('selectAll')}
              >
                全选
              </MenuItem>
            </AppMenu>

            <AppMenu
              label="查看"
              onRequestClose={closeMenu}
              triggerRef={ref => { menuTriggerRefs.current.view = ref }}
              value="view"
              width={260}
            >
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
              onRequestClose={closeMenu}
              triggerRef={ref => { menuTriggerRefs.current.window = ref }}
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
              onRequestClose={closeMenu}
              triggerRef={ref => {
                helpMenuTriggerRef.current = ref
                menuTriggerRefs.current.help = ref
              }}
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

        <WindowControls
          isMaximized={isMaximized}
          onClose={onClose}
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
        />
      </div>
    </div>
  )
}

export function WindowControls({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps): React.ReactNode {
  return (
    <div className="window-controls">
      <button
        aria-label="最小化"
        className="window-control-button"
        onClick={onMinimize}
        title="最小化"
        type="button"
      >
        <Minus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </button>
      <button
        aria-label={isMaximized ? '还原' : '最大化'}
        className="window-control-button"
        onClick={onToggleMaximize}
        title={isMaximized ? '还原' : '最大化'}
        type="button"
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
      </button>
      <button
        aria-label="关闭"
        className="window-control-button close"
        onClick={onClose}
        title="关闭"
        type="button"
      >
        <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </button>
    </div>
  )
}
