import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const sidebarRef = useRef<HTMLElement>(null);
  const hoverSidebarRef = useRef<HTMLElement>(null);
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

  useLayoutEffect(() => {
    const roots = [sidebarRef.current, hoverSidebarRef.current].filter(
      (root): root is HTMLElement => root !== null,
    );
    if (roots.length === 0) return;

    const footerEntries = roots
      .map(root => ({
        footer: root.querySelector<HTMLElement>(".sidebar-footer"),
        root,
      }))
      .filter(
        (entry): entry is { footer: HTMLElement; root: HTMLElement } =>
          entry.footer !== null,
      );

    function updateFooterHeight(entry: {
      footer: HTMLElement;
      root: HTMLElement;
    }): void {
      const footerStyle = window.getComputedStyle(entry.footer);
      const height = Math.ceil(
        entry.footer.getBoundingClientRect().height +
          Number.parseFloat(footerStyle.marginTop || "0") +
          Number.parseFloat(footerStyle.marginBottom || "0"),
      );
      entry.root.style.setProperty("--sidebar-footer-height", `${height}px`);
    }

    footerEntries.forEach(updateFooterHeight);
    const observer = new ResizeObserver(entries => {
      for (const resizeEntry of entries) {
        const match = footerEntries.find(entry => entry.footer === resizeEntry.target);
        if (match) updateFooterHeight(match);
      }
    });
    footerEntries.forEach(entry => observer.observe(entry.footer));

    return () => observer.disconnect();
  }, [collapsed, hoverOpen]);

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
        ref={sidebarRef}
        aria-label="侧边栏"
        className={[
          "desktop-sidebar",
          "tw:flex tw:h-full tw:shrink-0 tw:flex-col tw:overflow-hidden tw:bg-app-chrome tw:text-app-text",
          collapsed ? "is-collapsed" : "",
          resizing ? "is-resizing" : "",
        ].join(" ")}
        style={{ "--sidebar-current-width": `${width}px` } as React.CSSProperties}
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
          ref={hoverSidebarRef}
          aria-label="侧边栏"
          animate={{
            opacity: hoverClosing ? 0 : 1,
            x: hoverClosing ? -8 : 0,
          }}
          className="desktop-sidebar-hover-overlay tw:absolute tw:inset-y-0 tw:left-0 tw:flex tw:h-full tw:flex-col tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border tw:bg-app-chrome tw:text-app-text tw:shadow-md"
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
            { "--sidebar-current-width": `${width}px` } as React.CSSProperties
          }
          transition={motionTransition(reducedMotion, standardTween)}
        >
          {children}
        </motion.aside>
      ) : null}
    </>
  );
}
