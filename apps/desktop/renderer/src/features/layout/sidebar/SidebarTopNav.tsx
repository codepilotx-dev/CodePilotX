import type React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Boxes,
  BellDot,
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

type SidebarNavItem = {
  view: AppView;
  label: string;
  icon: React.ReactNode;
  path: string;
};

export const TOP_NAV_ITEMS: SidebarNavItem[] = [
  {
    view: "new",
    label: "新建任务",
    icon: <SquarePen size={APP_ICON_SIZE} />,
    path: "/new",
  },
  {
    view: "pullRequests",
    label: "拉取请求",
    icon: <GitPullRequest size={APP_ICON_SIZE} />,
    path: "/pull-requests",
  },
  {
    view: "automations",
    label: "自动化",
    icon: <Clock3 size={APP_ICON_SIZE} />,
    path: "/automations",
  },
  {
    view: "plugins",
    label: "插件",
    icon: <Boxes size={APP_ICON_SIZE} />,
    path: "/plugins",
  },
  {
    view: "models",
    label: "供应商",
    icon: <BrainCircuit size={APP_ICON_SIZE} />,
    path: "/models",
  },
  {
    view: "labs",
    label: "Codex Labs",
    icon: <FlaskConical size={APP_ICON_SIZE} />,
    path: "/labs",
  },
];

export const PROJECTS_NAV_ITEM: SidebarNavItem = {
  view: 'projects',
  label: '项目',
  icon: <FolderKanban size={APP_ICON_SIZE} />,
  path: '/projects',
}

export function getSidebarTopNavItems(
  showProjects: boolean,
): SidebarNavItem[] {
  if (!showProjects) return TOP_NAV_ITEMS
  return [
    TOP_NAV_ITEMS[0]!,
    PROJECTS_NAV_ITEM,
    ...TOP_NAV_ITEMS.slice(1),
  ]
}

type Props = {
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
  onOpenCommandMenu,
}: {
  onOpenCommandMenu: () => void
}): React.ReactNode {
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const {
    sidebarProductMode,
    setSidebarProductMode,
    sidebarPriorityFilterEnabled,
    setSidebarPriorityFilterEnabled,
  } = useDesktopSettings()
  const activeMode = SIDEBAR_PRODUCT_MODE_META[sidebarProductMode]
  const priorityToggleLabel = sidebarPriorityFilterEnabled
    ? "关闭优先级筛选器"
    : "按优先级筛选"
  const priorityToggleTitle = sidebarPriorityFilterEnabled
    ? "关闭优先级筛选器 (Ctrl+Alt+U)"
    : "按优先级筛选 (Ctrl+Alt+U)"

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
            setSidebarProductMode(value as typeof sidebarProductMode)
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
        <Tooltip content={priorityToggleTitle} side="bottom">
          <IconButton
            aria-label={priorityToggleLabel}
            aria-keyshortcuts="Control+Alt+U"
            aria-pressed={sidebarPriorityFilterEnabled}
            active={sidebarPriorityFilterEnabled}
            className="sidebar-priority-filter-button"
            onClick={() => setSidebarPriorityFilterEnabled(v => !v)}
            title={priorityToggleTitle}
          >
            <BellDot size={APP_ICON_SIZE} />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  )
}

export function SidebarTopNav({
  isActiveView,
  showProjects,
}: Props): React.ReactNode {
  return (
    <nav className="sidebar-top-nav tw:flex tw:flex-col tw:gap-0.5 tw:px-1.5" aria-label="主要导航">
      {getSidebarTopNavItems(showProjects).map((item) => {
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
    </nav>
  );
}
