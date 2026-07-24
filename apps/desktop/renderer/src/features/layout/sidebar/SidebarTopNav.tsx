import type React from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Boxes,
  BrainCircuit,
  ChevronDown,
  Clock3,
  FlaskConical,
  GitPullRequest,
  Search,
  SquarePen,
} from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { SidebarProductMode } from "../../../../shared/types.js";
import type { AppView } from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
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
    label: "模型中心",
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

type Props = {
  isActiveView: (view: AppView) => boolean;
};

const PRODUCT_MODE_LABELS: Record<SidebarProductMode, string> = {
  coding: 'Coding',
  working: 'Working',
}

export function SidebarHeader(): React.ReactNode {
  const navigate = useNavigate()
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const {
    sidebarProductMode,
    setSidebarProductMode,
  } = useDesktopSettings()

  return (
    <header className="sidebar-header">
      <PopoverMenu
        align="start"
        open={modeMenuOpen}
        side="bottom"
        width={184}
        trigger={
          <button
            aria-label={`切换工作模式，当前为 ${PRODUCT_MODE_LABELS[sidebarProductMode]}`}
            className="sidebar-product-mode-trigger"
            type="button"
          >
            <span>{PRODUCT_MODE_LABELS[sidebarProductMode]}</span>
            <ChevronDown aria-hidden="true" size={14} />
          </button>
        }
        onOpenChange={setModeMenuOpen}
      >
        <PopoverItem
          selected={sidebarProductMode === 'coding'}
          withCheck
          onClick={() => setSidebarProductMode('coding')}
        >
          Coding
        </PopoverItem>
        <PopoverItem
          selected={sidebarProductMode === 'working'}
          withCheck
          onClick={() => setSidebarProductMode('working')}
        >
          Working
        </PopoverItem>
      </PopoverMenu>
      <IconButton
        className="sidebar-search-button"
        onClick={() => navigate('/search')}
        title="搜索"
      >
        <Search size={APP_ICON_SIZE} />
      </IconButton>
    </header>
  )
}

export function SidebarTopNav({ isActiveView }: Props): React.ReactNode {
  return (
    <nav className="sidebar-top-nav tw:flex tw:flex-col tw:gap-0.5 tw:px-1.5" aria-label="主要导航">
      {TOP_NAV_ITEMS.map((item) => {
        const active = isActiveView(item.view);
        return (
          <SidebarRow
            active={active}
            asChild
            className={cx("sidebar-nav-link", active ? "active" : undefined)}
            key={item.view}
            labelClassName={cx('sidebar-item-label', 'u-min-w-0', 'u-truncate')}
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
