import type React from "react";
import { useEffect, useState } from "react";
import { Bot, History } from "lucide-react";
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { motion } from "motion/react";
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import { motionTransition, standardTween } from '../motion/motionTransitions.js'
import {
  SIDEBAR_COLLAPSE_HOLD_MS,
  SIDEBAR_COLLAPSE_TARGET_SIZE,
  useSidebarResizeCollapseConfirm,
} from './useSidebarResizeCollapseConfirm.js'

type Props = {
  children: React.ReactNode;
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  width: number;
  onCollapse: () => void;
  onSetWidth: (width: number) => void;
};

export function SidebarFrame({
  children,
  collapsed,
  maxWidth,
  minWidth,
  width,
  onCollapse,
  onSetWidth,
}: Props): React.ReactNode {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [hoverClosing, setHoverClosing] = useState(false);
  const reducedMotion = usePrefersReducedMotion()
  const {
    collapseConfirmKey,
    collapseConfirmTarget,
    handleResizeKey,
    resizing,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed,
    maxWidth,
    minWidth,
    width,
    onCollapse,
    onSetWidth,
  });

  function openHoverSidebar(): void {
    setHoverClosing(false);
    setHoverOpen(true);
  }

  function closeHoverSidebar(): void {
    if (!hoverOpen || hoverClosing) return;
    setHoverClosing(true);
  }

  useEffect(() => {
    if (!collapsed) {
      setHoverOpen(false);
      setHoverClosing(false);
    }
  }, [collapsed]);

  return (
    <>
      {collapsed && !hoverOpen ? (
        <div
          aria-hidden="true"
          className="sidebar-hover-zone"
          onPointerEnter={openHoverSidebar}
        />
      ) : null}
      <aside
        aria-label="侧边栏"
        className={[
          "desktop-sidebar",
          collapsed ? "is-collapsed" : "",
          resizing ? "is-resizing" : "",
        ].join(" ")}
        style={{ "--sidebar-current-w": `${width}px` } as React.CSSProperties}
      >
        {collapsed && hoverOpen ? null : children}

        <div
          aria-label="调整侧边栏宽度"
          aria-orientation="vertical"
          aria-valuemax={maxWidth}
          aria-valuemin={minWidth}
          aria-valuenow={width}
          className="sidebar-resizer"
          onKeyDown={handleResizeKey}
          onPointerDown={startResize}
          role="separator"
          tabIndex={0}
        />
        <div className="icon-button sidebar-brand-floating">
          <Bot size={APP_ICON_SIZE} />
        </div>
        <History className="icon-button sidebar-history-watermark" size={APP_ICON_SIZE} />
      </aside>
      {collapseConfirmTarget ? (
        <div
          key={collapseConfirmKey}
          aria-hidden="true"
          className="sidebar-collapse-confirm-target"
          style={{
            "--sidebar-collapse-target-ms": `${SIDEBAR_COLLAPSE_HOLD_MS}ms`,
            "--sidebar-collapse-target-size": `${SIDEBAR_COLLAPSE_TARGET_SIZE}px`,
            left: `${collapseConfirmTarget.x}px`,
            top: `${collapseConfirmTarget.y}px`,
          } as React.CSSProperties}
        />
      ) : null}
      {collapsed && hoverOpen ? (
        <motion.aside
          aria-label="侧边栏"
          animate={{
            opacity: hoverClosing ? 0 : 1,
            x: hoverClosing ? -8 : 0,
          }}
          className="desktop-sidebar-hover-overlay"
          initial={{ opacity: 0, x: -10 }}
          onAnimationComplete={() => {
            if (hoverClosing) {
              setHoverOpen(false);
              setHoverClosing(false);
            }
          }}
          onPointerEnter={openHoverSidebar}
          onPointerLeave={closeHoverSidebar}
          style={
            { "--sidebar-current-w": `${width}px` } as React.CSSProperties
          }
          transition={motionTransition(reducedMotion, standardTween)}
        >
          {children}
        </motion.aside>
      ) : null}
    </>
  );
}
