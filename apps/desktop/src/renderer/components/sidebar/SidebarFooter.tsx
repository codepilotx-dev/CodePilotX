import type React from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  CircleUser,
  Gauge,
  LogOut,
  Send,
  Settings2,
  Smartphone,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { APP_ICON_SIZE } from '../ui/iconTokens.js'
import { desktopClient } from '../../services/desktopClient.js'
import { IconButton } from "../ui/IconButton.js";
import { PopoverItem } from "../ui/PopoverItem.js";
import { PopoverMenu } from "../ui/PopoverMenu.js";
import { SidebarRow } from "./SidebarRow.js";

const USAGE_ROWS = [
  { label: "5 小时", percent: 79, detail: "06:26" },
  { label: "1 周", percent: 61, detail: "6月25日" },
];

export function SidebarFooter(): React.ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const settingsActive = location.pathname === "/settings";

  return (
    <footer className="sidebar-footer">
      <PopoverMenu
        className="popover-sidebar-footer"
        open={menuOpen}
        side="top"
        trigger={
          <SidebarRow
            active={settingsActive}
            asChild
            className="sidebar-settings-link"
            labelClassName="sidebar-settings-label"
            leading={<Settings2 size={APP_ICON_SIZE} />}
          >
            <button className="sidebar-footer-trigger" type="button">
              设置
            </button>
          </SidebarRow>
        }
        onOpenChange={setMenuOpen}
      >
        <div className="popover-section">
          <PopoverItem
            icon={<CircleUser size={APP_ICON_SIZE} />}
            onClick={() => {
              setMenuOpen(false);
              navigate("/settings?tab=profile");
            }}
          >
            个人资料
          </PopoverItem>
          <PopoverItem
            active={settingsActive}
            icon={<Settings2 size={APP_ICON_SIZE} />}
            shortcut="Ctrl+,"
            onClick={() => {
              setMenuOpen(false);
              navigate("/settings");
            }}
          >
            设置
          </PopoverItem>
          <PopoverItem
            icon={<Send size={APP_ICON_SIZE} />}
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            邀请好友
          </PopoverItem>
        </div>
        <div className="popover-divider" />
        <div className="popover-section">
          <PopoverItem
            icon={<Gauge size={APP_ICON_SIZE} />}
            withArrow
            arrowDirection={usageExpanded ? "up" : "down"}
            keepOpen
            onClick={() => setUsageExpanded(prev => !prev)}
          >
            剩余用量
          </PopoverItem>
          <AnimatePresence initial={false}>
            {usageExpanded ? (
              <motion.div
                animate={{ height: "auto", opacity: 1, y: 0 }}
                className="popover-usage-panel"
                exit={{ height: 0, opacity: 0, y: -4 }}
                initial={{ height: 0, opacity: 0, y: -4 }}
                key="usage-panel"
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {USAGE_ROWS.map(row => (
                  <div className="popover-usage-row" key={row.label}>
                    <span className="popover-usage-label">{row.label}</span>
                    <span className="popover-usage-track">
                      <span
                        className="popover-usage-fill"
                        style={{ width: `${row.percent}%` }}
                      />
                    </span>
                    <span className="popover-usage-percent">
                      {row.percent}%
                    </span>
                    <span className="popover-usage-detail">{row.detail}</span>
                  </div>
                ))}
                <div className="popover-usage-divider" />
                <button
                  className="popover-usage-action"
                  onClick={() => setMenuOpen(false)}
                  type="button"
                >
                  <span className="popover-usage-action-label">了解更多</span>
                  <ArrowUpRight
                    className="popover-usage-action-icon"
                    size={APP_ICON_SIZE}
                  />
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <PopoverItem
            icon={<LogOut size={APP_ICON_SIZE} />}
            onClick={() => {
              setMenuOpen(false);
              void desktopClient.logOut();
            }}
          >
            退出登录
          </PopoverItem>
        </div>
      </PopoverMenu>
      <IconButton
        className="icon-button sidebar-mobile-button"
        onClick={() => {}}
        title="移动端"
      >
        <Smartphone size={APP_ICON_SIZE} />
      </IconButton>
    </footer>
  );
}
