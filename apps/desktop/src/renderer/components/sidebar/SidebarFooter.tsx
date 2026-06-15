import type React from "react";
import { Link } from "react-router-dom";
import { Settings2, Smartphone } from "lucide-react";
import { IconButton } from "../ui/IconButton.js";

export function SidebarFooter(): React.ReactNode {
  return (
    <footer className="sidebar-footer">
      <Link className="sidebar-settings-link" to="/settings">
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
