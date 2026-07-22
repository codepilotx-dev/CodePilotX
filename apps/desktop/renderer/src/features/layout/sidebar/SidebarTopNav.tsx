import type React from "react";
import { Link } from "react-router-dom";
import { Boxes, BrainCircuit, Clock3, Search, SquarePen } from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { AppView } from "../../../uiTypes.js";
import { cx } from "../../../utils/cx.js";
import { SidebarRow } from "./SidebarRow.js";

type SidebarNavItem = {
  view: AppView;
  label: string;
  icon: React.ReactNode;
  path: string;
  showActiveStyle?: boolean;
};

export const TOP_NAV_ITEMS: SidebarNavItem[] = [
  {
    view: "quickChat",
    label: "快速对话",
    icon: <SquarePen size={APP_ICON_SIZE} />,
    path: "/quick-chat",
    showActiveStyle: false,
  },
  {
    view: "search",
    label: "搜索",
    icon: <Search size={APP_ICON_SIZE} />,
    path: "/search",
    showActiveStyle: false,
  },
  {
    view: "models",
    label: "模型中心",
    icon: <BrainCircuit size={APP_ICON_SIZE} />,
    path: "/models",
  },
  {
    view: "plugins",
    label: "插件",
    icon: <Boxes size={APP_ICON_SIZE} />,
    path: "/plugins",
  },
  {
    view: "automation",
    label: "自动化",
    icon: <Clock3 size={APP_ICON_SIZE} />,
    path: "/automation",
  },
];

type Props = {
  isActiveView: (view: AppView) => boolean;
};

export function SidebarTopNav({ isActiveView }: Props): React.ReactNode {
  return (
    <nav className="sidebar-top-nav tw:flex tw:flex-col tw:gap-0.5 tw:px-1.5" aria-label="快捷入口">
      {TOP_NAV_ITEMS.map((item) => {
        const showActiveStyle = item.showActiveStyle !== false && isActiveView(item.view);
        return (
          <SidebarRow
            active={showActiveStyle}
            asChild
            className={showActiveStyle ? "sidebar-nav-link active" : "sidebar-nav-link"}
            key={item.view}
            labelClassName={cx('sidebar-item-label', 'u-min-w-0', 'u-truncate')}
            leading={item.icon}
          >
            <Link to={item.path}>{item.label}</Link>
          </SidebarRow>
        );
      })}
    </nav>
  );
}
