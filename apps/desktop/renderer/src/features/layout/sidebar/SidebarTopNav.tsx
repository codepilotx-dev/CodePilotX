import type React from "react";
import { useState } from "react";
import type { ProtocolCapability } from '@codepilotx/agent-protocol'
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  BellDot,
  Boxes,
  BrainCircuit,
  ChevronDown,
  Clock3,
  FlaskConical,
  FolderKanban,
  GitPullRequest,
  Search,
  SquarePen,
} from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
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
    label: "新建任务",
    icon: <SquarePen size={APP_ICON_SIZE} />,
    path: "/new",
    availability: { kind: 'always' },
  },
  {
    view: "pullRequests",
    label: "拉取请求",
    icon: <GitPullRequest size={APP_ICON_SIZE} />,
    path: "/pull-requests",
    availability: {
      kind: 'any-capability',
      capabilities: ['github.pullRequests.v1'],
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
  {
    view: "labs",
    label: "Codex Labs",
    icon: <FlaskConical size={APP_ICON_SIZE} />,
    path: "/labs",
    availability: { kind: 'always' },
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
    PROJECTS_NAV_ITEM,
    ...TOP_NAV_ITEMS.slice(1),
  ] : [newItem, ...TOP_NAV_ITEMS.slice(1)]

  if (capabilityState.status !== 'ready') return items
  return items.filter(item =>
    item.availability.kind === 'always'
    || item.availability.capabilities.some(capability =>
      capabilityState.capabilities.has(capability),
    ),
  )
}

/**
 * 将最终导航数组拆成固定入口（新建任务）与可滚动入口；
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
  hasAttention,
  onOpenCommandMenu,
}: {
  hasAttention: boolean
  onOpenCommandMenu: () => void
}): React.ReactNode {
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const navigate = useNavigate()
  const {
    sidebarProductMode,
    setSidebarProductMode,
    sidebarTimelineEnabled,
    setSidebarTimelineEnabled,
  } = useDesktopSettings()
  const activeMode = SIDEBAR_PRODUCT_MODE_META[sidebarProductMode]
  const timelineToggleLabel = sidebarTimelineEnabled
    ? "关闭时间线"
    : hasAttention
      ? "打开时间线，有需要关注的任务"
      : "打开时间线"
  const timelineToggleTitle = sidebarTimelineEnabled
    ? "关闭时间线 (Ctrl+Alt+U)"
    : `${timelineToggleLabel} (Ctrl+Alt+U)`

  const handleModeChange = (value: SidebarProductMode): void => {
    setSidebarProductMode(value)
    // 模式切换直接导航到对应 Surface 新建页；正在查看的 thread 任务不会被删除或归档
    navigate(newSessionPath(value))
  }

  return (
    <header className="sidebar-header">
      <PopoverMenu
        align="start"
        className="popover-menu--flex sidebar-product-mode-menu"
        maxWidth="calc(100vw - 24px)"
        open={modeMenuOpen}
        side="bottom"
        width={248}
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
              <PopoverRadioItem key={value} value={value}>
                <span className="sidebar-product-mode-option">
                  <span className="sidebar-product-mode-option__label">
                    {option.label}
                  </span>
                  <span className="sidebar-product-mode-option__description">
                    {option.description}
                  </span>
                </span>
              </PopoverRadioItem>
            )
          })}
        </PopoverRadioGroup>
      </PopoverMenu>
      <div className="sidebar-header-actions">
        <IconButton
          aria-haspopup="dialog"
          className="sidebar-search-button"
          onClick={onOpenCommandMenu}
          title="搜索任务"
        >
          <Search size={APP_ICON_SIZE} />
        </IconButton>
        <Tooltip content={timelineToggleTitle} side="bottom">
          <IconButton
            aria-label={timelineToggleLabel}
            aria-keyshortcuts="Control+Alt+U"
            aria-pressed={sidebarTimelineEnabled}
            active={sidebarTimelineEnabled}
            className="sidebar-timeline-toggle-button"
            onClick={() => setSidebarTimelineEnabled(v => !v)}
            title={timelineToggleTitle}
          >
            {hasAttention ? (
              <BellDot aria-hidden="true" size={APP_ICON_SIZE} />
            ) : (
              <Bell aria-hidden="true" size={APP_ICON_SIZE} />
            )}
          </IconButton>
        </Tooltip>
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
 * 固定在侧栏顶部的“新建任务”入口；与可滚动导航共用相同的
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
      aria-label="新建任务"
      className="sidebar-new-task-nav sidebar-top-nav tw:flex tw:flex-col tw:gap-0.5 tw:px-1.5"
      data-scroll-overlap={scrollOverlapping ? 'true' : 'false'}
    >
      <SidebarNavItems items={fixedItems} isActiveView={isActiveView} />
    </nav>
  );
}
