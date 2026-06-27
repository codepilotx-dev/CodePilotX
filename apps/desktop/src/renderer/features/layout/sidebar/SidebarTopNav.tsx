import type React from "react";
import { Link } from "react-router-dom";
import { Boxes, Clock3, Search, SquarePen } from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { AppView } from "../../../uiTypes.js";
import { SidebarRow } from "./SidebarRow.js";

type SidebarNavItem = {
  view: AppView;
  label: string;
  icon: React.ReactNode;
  path: string;
};

const TOP_NAV_ITEMS: SidebarNavItem[] = [
  {
    view: "quickChat",
    label: "快速对话",
    icon: <SquarePen size={APP_ICON_SIZE} />,
    path: "/quick-chat",
  },
  {
    view: "search",
    label: "搜索",
    icon: <Search size={APP_ICON_SIZE} />,
    path: "/search",
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
    <nav className="sidebar-top-nav" aria-label="快捷入口">
      {TOP_NAV_ITEMS.map((item) => (
        <SidebarRow
          active={isActiveView(item.view)}
          asChild
          className={
            isActiveView(item.view)
              ? "sidebar-nav-link active"
              : "sidebar-nav-link"
          }
          key={item.view}
          labelClassName="sidebar-item-label"
          leading={item.icon}
        >
          <Link to={item.path}>{item.label}</Link>
        </SidebarRow>
      ))}
    </nav>
  );
}
