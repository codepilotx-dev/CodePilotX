import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { MoveDown, MoveRight, Pin, Plus, X } from 'lucide-react'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import {
  PopoverRadioGroup,
  PopoverRadioItem,
} from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import type {
  WorkbenchPanelSnapshot,
  WorkbenchPanelTarget,
  WorkbenchTabDescriptor,
  WorkbenchTabId,
  WorkbenchTabsState,
} from '../dock/rightDockState.js'
import {
  createLauncherTab,
  getWorkbenchLauncherDefinitions,
  getWorkbenchLauncherPresentation,
  getWorkbenchTabDefinition,
  getWorkbenchTabDisplayTitle,
} from './workbenchTabRegistry.js'

export type WorkbenchTabStripProps = {
  target: WorkbenchPanelTarget
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  terminalDisplayPath: string | null
  onClosePanel?: () => void
  onCloseTab: (tabId: WorkbenchTabId) => void
  onCloseOtherTabs: (tabId: WorkbenchTabId) => void
  onCloseTabsToRight: (tabId: WorkbenchTabId) => void
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
  onCreateSideChat: () => void
  sideChatAvailable: boolean
  onSelectTab: (tabId: WorkbenchTabId) => void
  onMoveTab: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index?: number,
  ) => void
  onReorderTab: (
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index: number,
  ) => void
  onPinTab: (tabId: WorkbenchTabId) => void
}

export function WorkbenchTabStrip({
  target,
  state,
  tabsById,
  terminalDisplayPath,
  onClosePanel,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onOpenTab,
  onCreateSideChat,
  sideChatAvailable,
  onSelectTab,
  onMoveTab,
  onReorderTab,
  onPinTab,
}: WorkbenchTabStripProps): React.ReactNode {
  const tabRefs = useRef(new Map<WorkbenchTabId, HTMLButtonElement>())
  const [menuOpen, setMenuOpen] = useState(false)
  const launchers = useMemo(
    () =>
      getWorkbenchLauncherDefinitions().filter(
        definition => definition.kind !== 'side-chat' || sideChatAvailable,
      ),
    [sideChatAvailable],
  )

  useEffect(() => {
    const activeTabId = state.activeTabId
    if (!activeTabId) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [state.activeTabId])

  const focusAt = (index: number): void => {
    const tabId = state.tabIds[index]
    if (!tabId) return
    onSelectTab(tabId)
    requestAnimationFrame(() => tabRefs.current.get(tabId)?.focus())
  }

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    tabId: WorkbenchTabId,
  ): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAt((index - 1 + state.tabIds.length) % state.tabIds.length)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAt((index + 1) % state.tabIds.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(state.tabIds.length - 1)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      onCloseTab(tabId)
    }
  }

  return (
    <div className="right-dock-tabs-header">
      <div className="right-dock-tabs-viewport">
        <div
          aria-label={target === 'right' ? '右侧面板标签' : '底部面板标签'}
          className="right-dock-tab-list"
          role="tablist"
        >
          {state.tabIds.map((tabId, index) => {
            const tab = tabsById[tabId]
            if (!tab) return null
            const definition = getWorkbenchTabDefinition(tab)
            const tabIcon = definition.getIcon?.(tab) ?? definition.icon
            const tabTitle = getWorkbenchTabDisplayTitle(
              tab,
              terminalDisplayPath,
            )
            const active = state.activeTabId === tab.id
            const canCloseRight = index < state.tabIds.length - 1
            const hasDivider =
              !active &&
              canCloseRight &&
              state.tabIds[index + 1] !== state.activeTabId
            return (
              <Fragment key={tab.id}>
                <AppContextMenu
                  actions={[
                    ...(tab.kind === 'file-preview' && tab.preview
                      ? [
                          {
                            kind: 'item' as const,
                            label: '固定预览',
                            icon: <Pin size={APP_ICON_SIZE} />,
                            onSelect: () => onPinTab(tab.id),
                          },
                        ]
                      : []),
                    {
                      kind: 'item',
                      label: '关闭',
                      onSelect: () => onCloseTab(tab.id),
                    },
                    {
                      kind: 'item',
                      label: '关闭其他标签',
                      disabled: state.tabIds.length <= 1,
                      onSelect: () => onCloseOtherTabs(tab.id),
                    },
                    {
                      kind: 'item',
                      label: '关闭右侧标签',
                      disabled: !canCloseRight,
                      onSelect: () => onCloseTabsToRight(tab.id),
                    },
                    { kind: 'separator' },
                    {
                      kind: 'item',
                      label: `移到${target === 'right' ? '底部' : '右侧'}面板`,
                      icon:
                        target === 'right' ? (
                          <MoveDown size={APP_ICON_SIZE} />
                        ) : (
                          <MoveRight size={APP_ICON_SIZE} />
                        ),
                      onSelect: () =>
                        onMoveTab(
                          target,
                          target === 'right' ? 'bottom' : 'right',
                          tab.id,
                        ),
                    },
                  ]}
                  layout="grid"
                  trigger={
                    <div
                      className={`right-dock-tab-wrap${active ? ' active' : ''}${hasDivider ? ' has-divider' : ''}`}
                      data-panel-tab={tab.id}
                      draggable
                      onDragEnd={event =>
                        event.currentTarget.classList.remove('dragging')
                      }
                      onDragOver={event => event.preventDefault()}
                      onDragStart={event => {
                        event.currentTarget.classList.add('dragging')
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(
                          'application/x-codepilotx-workbench-tab',
                          JSON.stringify({ source: target, tabId: tab.id }),
                        )
                      }}
                      onDrop={event => {
                        event.preventDefault()
                        const payload = readTabDragPayload(event)
                        if (!payload) return
                        if (payload.source === target) {
                          onReorderTab(target, payload.tabId, index)
                        } else {
                          onMoveTab(
                            payload.source,
                            target,
                            payload.tabId,
                            index,
                          )
                        }
                      }}
                    >
                      <button
                        ref={element => {
                          if (element) tabRefs.current.set(tab.id, element)
                          else tabRefs.current.delete(tab.id)
                        }}
                        aria-controls={`workbench-panel-${target}-${domId(tab.id)}`}
                        aria-selected={active}
                        className={`right-dock-tab${active ? ' active' : ''}${
                          tab.kind === 'file-preview' && tab.preview
                            ? ' preview'
                            : ''
                        }`}
                        id={`workbench-tab-${target}-${domId(tab.id)}`}
                        role="tab"
                        tabIndex={active ? 0 : -1}
                        title={tabTitle}
                        type="button"
                        onClick={() => onSelectTab(tab.id)}
                        onDoubleClick={() => {
                          if (tab.kind === 'file-preview' && tab.preview) {
                            onPinTab(tab.id)
                          }
                        }}
                        onKeyDown={event =>
                          handleTabKeyDown(event, index, tab.id)
                        }
                        onMouseDown={event => {
                          if (event.button !== 1) return
                          event.preventDefault()
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                      >
                        <span className="right-dock-tab-icon">{tabIcon}</span>
                        <span className="right-dock-tab-title">
                          {tabTitle}
                        </span>
                      </button>
                      <IconButton
                        className="right-dock-tab-close"
                        color="ghost"
                        size="iconMd"
                        title={`关闭 ${tabTitle}`}
                        onMouseDown={event => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                      >
                        <X
                          size={APP_ICON_SIZE}
                          strokeWidth={APP_ICON_STROKE_WIDTH}
                        />
                      </IconButton>
                    </div>
                  }
                  width="auto"
                />
              </Fragment>
            )
          })}
          {state.tabIds.length > 0 ? (
            <PopoverMenu
              align="end"
              avoidCollisions={false}
              className="popover-right-dock-add popover-menu--grid"
              collisionPadding={6}
              open={menuOpen}
              side="bottom"
              sideOffset={4}
              width={220}
              trigger={
                <IconButton
                  className="right-dock-add-button"
                  color="ghostSecondary"
                  size="toolbar"
                  title="添加标签"
                >
                  <Plus
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </IconButton>
              }
              onOpenChange={setMenuOpen}
            >
              <PopoverRadioGroup
                value={
                  launchers.find(
                    definition =>
                      createLauncherTab(definition.kind)?.id ===
                      state.activeTabId,
                  )?.kind ?? ''
                }
                onValueChange={kind => {
                  const definition = launchers.find(item => item.kind === kind)
                  if (!definition) return
                  if (definition.kind === 'side-chat') {
                    onCreateSideChat()
                    setMenuOpen(false)
                    return
                  }
                  const candidate = createLauncherTab(definition.kind)
                  if (!candidate) return
                  if (state.tabIds.includes(candidate.id)) {
                    onSelectTab(candidate.id)
                  } else {
                    onOpenTab(candidate)
                  }
                  setMenuOpen(false)
                }}
              >
                {launchers.map(definition => {
                  const presentation =
                    getWorkbenchLauncherPresentation(definition)
                  return (
                    <PopoverRadioItem
                      icon={presentation.icon}
                      key={definition.kind}
                      shortcut={presentation.shortcut}
                      value={definition.kind}
                    >
                      {presentation.label}
                    </PopoverRadioItem>
                  )
                })}
              </PopoverRadioGroup>
            </PopoverMenu>
          ) : null}
          <span
            aria-hidden="true"
            className="right-dock-tab-empty"
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault()
              const payload = readTabDragPayload(event)
              if (payload && payload.source !== target) {
                onMoveTab(payload.source, target, payload.tabId)
              }
            }}
          />
        </div>
      </div>
      {target === 'bottom' && onClosePanel ? (
        <IconButton
          className="bottom-panel-close"
          color="ghostSecondary"
          size="toolbar"
          title="关闭底部面板"
          onClick={onClosePanel}
        >
          <X
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </IconButton>
      ) : null}
    </div>
  )
}

function readTabDragPayload(
  event: React.DragEvent,
): {
  source: WorkbenchPanelTarget
  tabId: WorkbenchTabId
} | null {
  const raw = event.dataTransfer.getData(
    'application/x-codepilotx-workbench-tab',
  )
  try {
    const value = JSON.parse(raw) as {
      source?: unknown
      tabId?: unknown
    }
    if (
      (value.source === 'right' || value.source === 'bottom') &&
      typeof value.tabId === 'string'
    ) {
      return {
        source: value.source,
        tabId: value.tabId as WorkbenchTabId,
      }
    }
  } catch {
    /* Ignore unrelated drag payloads. */
  }
  return null
}

export function workbenchTabDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function domId(value: string): string {
  return workbenchTabDomId(value)
}
