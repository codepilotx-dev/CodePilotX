import type React from "react";
import { Link, useLocation } from "react-router-dom";
import { Settings2, Smartphone } from "lucide-react";
import { IconButton } from "../ui/IconButton.js";

export function SidebarFooter(): React.ReactNode {
  const location = useLocation();
  const settingsActive = location.pathname === "/settings";

  return (
    <footer className="sidebar-footer">
      <Link
        className={
          settingsActive ? "sidebar-settings-link active" : "sidebar-settings-link"
        }
        to="/settings"
      >
        <span className="icon-button sidebar-item-icon">
          <Settings2 size={14} />
        </span>
        <span>设置</span>
      </Link>
      <IconButton
        className="icon-button sidebar-mobile-button"
        onClick={() => {}}
        title="移动端"
      >
        <Smartphone size={14} />
      </IconButton>
    </footer>
  );
}
