import type React from "react";
import { useEffect, useState } from "react";
import { Bot, History } from "lucide-react";
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { motion } from "motion/react";

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
  const [resizing, setResizing] = useState(false);
  const [start, setStart] = useState({ x: 0, width });

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

  useEffect(() => {
    if (!resizing) return;

    function stopResize(): void {
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    function collapseResize(): void {
      stopResize();
      onCollapse();
    }

    function handlePointerMove(event: PointerEvent): void {
      const nextWidth = start.width + event.clientX - start.x;
      if (nextWidth <= minWidth) {
        onSetWidth(minWidth);
        collapseResize();
        return;
      }
      onSetWidth(nextWidth);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [minWidth, onCollapse, onSetWidth, resizing, start.width, start.x]);

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (collapsed) return;
    event.preventDefault();
    setStart({ x: event.clientX, width });
    setResizing(true);
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (collapsed) return;
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onSetWidth(width - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onSetWidth(width + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      onSetWidth(minWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      onSetWidth(maxWidth);
    }
  }

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
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.aside>
      ) : null}
    </>
  );
}
