import type React from "react";
import { useState } from "react";
import type { ProtocolCapability } from '@codepilotx/agent-protocol'
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  Boxes,
  BrainCircuit,
  ChevronDown,
  Clock3,
  FolderKanban,
  MessagesSquare,
  Search,
  SquarePen,
} from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import type { SidebarProductMode } from "../../../../shared/types.js";
import type { AppView } from "../../../uiTypes.js";
import { newSessionPath } from "../../session/newSessionSurface.js";
import type { NewSessionSurface } from "../../session/newSessionSurface.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import {
  PopoverRadioGroup,
  PopoverRadioItem,
} from "../../../components/ui/PopoverItem.js";
import * as Popover from '@radix-ui/react-popover'
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { cx } from "../../../utils/cx.js";
import { useDesktopSettings } from "../../settings/useDesktopSettings.js";
import { SidebarRow } from "./SidebarRow.js";

type SidebarNavAvailability =
  | { kind: 'always' }
  | {
      kind: 'any-capability'
      capabilities: readonly ProtocolCapability[]
    }

export type SidebarCapabilityState =
  | { status: 'unknown'; capabilities: null }
  | { status: 'ready'; capabilities: ReadonlySet<ProtocolCapability> }
  | { status: 'unavailable'; capabilities: null }

export type SidebarNavItem = {
  view: AppView;
  label: string;
  icon: React.ReactNode;
  path: string;
  availability: SidebarNavAvailability;
};

export const UNKNOWN_SIDEBAR_CAPABILITY_STATE: SidebarCapabilityState = {
  status: 'unknown',
  capabilities: null,
}

export const TOP_NAV_ITEMS: SidebarNavItem[] = [
  {
    view: "new",
    label: "新建对话",
    icon: <SquarePen size={APP_ICON_SIZE} />,
    path: "/new",
    availability: { kind: 'always' },
  },
  {
    view: 'sessionGroups',
    label: '会话组',
    icon: <MessagesSquare size={APP_ICON_SIZE} />,
    path: '/session-groups',
    availability: {
      kind: 'any-capability',
      capabilities: ['session-group.v1' as ProtocolCapability],
    },
  },
  {
    view: "automations",
    label: "自动化",
    icon: <Clock3 size={APP_ICON_SIZE} />,
    path: "/automations",
    availability: { kind: 'always' },
  },
  {
    view: "plugins",
    label: "插件",
    icon: <Boxes size={APP_ICON_SIZE} />,
    path: "/plugins",
    availability: {
      kind: 'any-capability',
      capabilities: ['skills.manage.v1', 'mcp.manage.v1'],
    },
  },
  {
    view: "models",
    label: "供应商",
    icon: <BrainCircuit size={APP_ICON_SIZE} />,
    path: "/models",
    availability: {
      kind: 'any-capability',
      capabilities: [
        'model.catalog.paged.v1',
        'provider.config.pi.v1',
        'provider.auth.pi.v1',
      ],
    },
  },
];

export const PROJECTS_NAV_ITEM: SidebarNavItem = {
  view: 'projects',
  label: '项目',
  icon: <FolderKanban size={APP_ICON_SIZE} />,
  path: '/projects',
  availability: { kind: 'always' },
}

export function getSidebarTopNavItems({
  showProjects,
  surface,
  capabilityState,
}: {
  showProjects: boolean
  surface?: NewSessionSurface
  capabilityState: SidebarCapabilityState
}): SidebarNavItem[] {
  const newItem = surface
    ? { ...TOP_NAV_ITEMS[0]!, path: newSessionPath(surface) }
    : TOP_NAV_ITEMS[0]!
  const items = showProjects ? [
    newItem,
    TOP_NAV_ITEMS[1]!,
    PROJECTS_NAV_ITEM,
    ...TOP_NAV_ITEMS.slice(2),
  ] : [newItem, ...TOP_NAV_ITEMS.slice(1)]

  // capability 未就绪或不可用时，仅暴露 always 入口，避免点入未接线的能力。
  if (capabilityState.status !== 'ready') {
    return items.filter(item => item.availability.kind === 'always')
  }
  return items.filter(item =>
    item.availability.kind === 'always'
    || item.availability.capabilities.some(capability =>
      capabilityState.capabilities.has(capability),
    ),
  )
}

/**
 * 将最终导航数组拆成固定入口（新建对话）与可滚动入口；
 * 扁平组织模式下的“项目”仍属于可滚动分组。
 */
export function splitSidebarTopNavItems(
  items: readonly SidebarNavItem[],
): { fixedItems: SidebarNavItem[]; scrollableItems: SidebarNavItem[] } {
  return {
    fixedItems: items.filter(item => item.view === 'new'),
    scrollableItems: items.filter(item => item.view !== 'new'),
  }
}

function SidebarNavItems({
  items,
  isActiveView,
}: {
  items: readonly SidebarNavItem[];
  isActiveView: (view: AppView) => boolean;
}): React.ReactNode {
  return (
    <>
      {items.map((item) => {
        const active = isActiveView(item.view);
        return (
          <SidebarRow
            active={active}
            asChild
            className={cx("sidebar-nav-link", active ? "active" : undefined)}
            key={item.view}
            labelClassName={cx('sidebar-item-label', 'u-min-w-0', 'u-truncate')}
            layout="flex"
            leading={item.icon}
          >
            <Link aria-current={active ? 'page' : undefined} to={item.path}>
              {item.label}
            </Link>
          </SidebarRow>
        );
      })}
    </>
  );
}

type Props = {
  capabilityState?: SidebarCapabilityState;
  isActiveView: (view: AppView) => boolean;
  showProjects: boolean;
};

export const SIDEBAR_PRODUCT_MODE_ORDER: readonly SidebarProductMode[] = [
  'coding',
  'working',
  'chat',
]

export const SIDEBAR_PRODUCT_MODE_META: Record<
  SidebarProductMode,
  { label: string; description: string }
> = {
  coding: {
    label: 'Coding',
    description: '构建、调试并发布',
  },
  working: {
    label: 'Working',
    description: '写作、分析和协作',
  },
  chat: {
    label: 'Chat',
    description: '创建、学习和探索',
  },
}

export function SidebarHeader({
  hasUnread = false,
  onOpenCommandMenu,
}: {
  hasUnread?: boolean
  onOpenCommandMenu: () => void
}): React.ReactNode {
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const navigate = useNavigate()
  const {
    sidebarProductMode,
    setSidebarProductMode,
    sidebarTimelineEnabled,
    setSidebarTimelineEnabled,
    sidebarActivityCoachmarkDismissed,
    setSidebarActivityCoachmarkDismissed,
  } = useDesktopSettings()
  const activeMode = SIDEBAR_PRODUCT_MODE_META[sidebarProductMode]
  const timelineToggleLabel = sidebarTimelineEnabled
    ? "关闭活动视图"
    : "查看活动"
  const timelineToggleTitle = `${timelineToggleLabel} (Ctrl+Alt+U)`

  const handleModeChange = (value: SidebarProductMode): void => {
    setSidebarProductMode(value)
    // 模式切换直接导航到对应 Surface 新建页；正在查看的 thread 任务不会被删除或归档
    navigate(newSessionPath(value))
  }

  return (
    <header className="sidebar-header tw:px-1.5">
      <PopoverMenu
        align="start"
        className="popover-menu--no-icons sidebar-product-mode-menu"
        maxWidth="calc(100vw - 24px)"
        open={modeMenuOpen}
        side="bottom"
        width={232}
        trigger={
          <button
            aria-label={`切换工作模式，当前为 ${activeMode.label}`}
            className="sidebar-product-mode-trigger"
            type="button"
          >
            <span>{activeMode.label}</span>
            <ChevronDown aria-hidden="true" size={14} />
          </button>
        }
        onOpenChange={setModeMenuOpen}
      >
        <PopoverRadioGroup
          value={sidebarProductMode}
          onValueChange={value =>
            handleModeChange(value as SidebarProductMode)
          }
        >
          {SIDEBAR_PRODUCT_MODE_ORDER.map(value => {
            const option = SIDEBAR_PRODUCT_MODE_META[value]
            return (
              <PopoverRadioItem
                description={option.description}
                key={value}
                value={value}
              >
                {option.label}
              </PopoverRadioItem>
            )
          })}
        </PopoverRadioGroup>
      </PopoverMenu>
      <div className="sidebar-header-actions">
        <IconButton
          aria-haspopup="dialog"
          className="sidebar-search-button"
          color="ghost"
          size="icon"
          onClick={onOpenCommandMenu}
          title="搜索任务"
        >
          <Search size={APP_ICON_SIZE} />
        </IconButton>
        <Popover.Root
          open={!sidebarActivityCoachmarkDismissed && !sidebarTimelineEnabled}
          onOpenChange={open => {
            if (!open) setSidebarActivityCoachmarkDismissed(true)
          }}
        >
          <Popover.Anchor asChild>
            <div className="tw:inline-flex">
              <Tooltip content={timelineToggleTitle} side="bottom">
                <IconButton
                  aria-label={timelineToggleLabel}
                  aria-keyshortcuts="Control+Alt+U"
                  aria-pressed={sidebarTimelineEnabled}
                  active={sidebarTimelineEnabled}
                  className="sidebar-timeline-toggle-button"
                  color="ghost"
                  size="icon"
                  onClick={() => {
                    if (!sidebarActivityCoachmarkDismissed) {
                      setSidebarActivityCoachmarkDismissed(true)
                    }
                    setSidebarTimelineEnabled(v => !v)
                  }}
                  title={timelineToggleTitle}
                >
                  <Bell aria-hidden="true" size={APP_ICON_SIZE}>
                    {hasUnread && (
                      <circle
                        cx="18"
                        cy="4"
                        r="4.5"
                        fill="var(--cpx-sys-color-accent)"
                        stroke="none"
                      />
                    )}
                  </Bell>
                </IconButton>
              </Tooltip>
            </div>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              align="end"
              side="bottom"
              sideOffset={8}
              className="popover-surface sidebar-activity-coachmark tw:z-50 tw:w-64 tw:rounded-xl tw:border tw:border-border tw:p-3.5 tw:outline-none"
            >
              <div className="tw:flex tw:flex-col tw:gap-2.5">
                <p className="tw:text-xs tw:text-foreground">
                  新的活动视图——集中查看进行中、待处理和未读会话。
                </p>
                <div className="tw:flex tw:justify-end">
                  <Button
                    size="compact"
                    onClick={() => setSidebarActivityCoachmarkDismissed(true)}
                  >
                    知道了
                  </Button>
                </div>
              </div>
              <Popover.Arrow className="tw:fill-popover" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </header>
  )
}

export function SidebarTopNav({
  capabilityState = UNKNOWN_SIDEBAR_CAPABILITY_STATE,
  isActiveView,
  showProjects,
}: Props): React.ReactNode {
  const { sidebarProductMode } = useDesktopSettings()
  const { scrollableItems } = splitSidebarTopNavItems(
    getSidebarTopNavItems({
      showProjects,
      surface: sidebarProductMode,
      capabilityState,
    }),
  )
  return (
    <nav className="sidebar-top-nav tw:flex tw:flex-col tw:gap-0.5 tw:px-1.5" aria-label="主要导航">
      <SidebarNavItems items={scrollableItems} isActiveView={isActiveView} />
    </nav>
  );
}

/**
 * 固定在侧栏顶部的“新建对话”入口；与可滚动导航共用相同的
 * active、键盘焦点、图标、路由和无障碍属性。
 * `scrollOverlapping` 由滚动视口的实际 scrollTop 驱动：
 * 内容滚过固定入口时显示边界分隔线，滚回顶部立即隐藏。
 */
export function SidebarNewTaskNav({
  isActiveView,
  scrollOverlapping,
}: {
  isActiveView: (view: AppView) => boolean;
  scrollOverlapping: boolean;
}): React.ReactNode {
  const { sidebarProductMode } = useDesktopSettings()
  const { fixedItems } = splitSidebarTopNavItems(
    getSidebarTopNavItems({
      showProjects: false,
      surface: sidebarProductMode,
      capabilityState: UNKNOWN_SIDEBAR_CAPABILITY_STATE,
    }),
  )
  return (
    <nav
      aria-label="新建对话"
      className="sidebar-new-task-nav sidebar-top-nav tw:flex tw:flex-col tw:gap-0.5 tw:px-1.5"
      data-scroll-overlap={scrollOverlapping ? 'true' : 'false'}
    >
      <SidebarNavItems items={fixedItems} isActiveView={isActiveView} />
    </nav>
  );
}
