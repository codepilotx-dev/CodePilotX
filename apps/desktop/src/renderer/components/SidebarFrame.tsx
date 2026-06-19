import type React from "react";
import { useEffect, useState } from "react";
import { Bot, History } from "lucide-react";

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
  const [resizing, setResizing] = useState(false);
  const [start, setStart] = useState({ x: 0, width });

  useEffect(() => {
    if (!collapsed) {
      setHoverOpen(false);
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
    <aside
      aria-label="侧边栏"
      className={[
        "desktop-sidebar",
        collapsed ? "is-collapsed" : "",
        collapsed && hoverOpen ? "is-hover-open" : "",
        resizing ? "is-resizing" : "",
      ].join(" ")}
      onPointerLeave={() => {
        if (collapsed) {
          setHoverOpen(false);
        }
      }}
      style={{ "--sidebar-current-w": `${width}px` } as React.CSSProperties}
    >
      {collapsed && !hoverOpen ? (
        <div
          aria-hidden="true"
          className="sidebar-hover-zone"
          onPointerEnter={() => setHoverOpen(true)}
        />
      ) : null}
      {children}

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
        <Bot size={14} />
      </div>
      <History className="icon-button sidebar-history-watermark" size={14} />
    </aside>
  );
}
