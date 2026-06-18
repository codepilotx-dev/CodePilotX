import type React from "react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bot, History } from "lucide-react";

type Props = {
  children: React.ReactNode;
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  slotKey: string;
  width: number;
  onSetWidth: (width: number) => void;
};

export function SidebarFrame({
  children,
  collapsed,
  maxWidth,
  minWidth,
  slotKey,
  width,
  onSetWidth,
}: Props): React.ReactNode {
  const [resizing, setResizing] = useState(false);
  const [start, setStart] = useState({ x: 0, width });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!resizing) return;

    function handlePointerMove(event: PointerEvent): void {
      onSetWidth(start.width + event.clientX - start.x);
    }

    function stopResize(): void {
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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
  }, [onSetWidth, resizing, start.width, start.x]);

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
        resizing ? "is-resizing" : "",
      ].join(" ")}
      style={{ "--sidebar-current-w": `${width}px` } as React.CSSProperties}
    >
      <div className="sidebar-slot">
        <AnimatePresence initial={false}>
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            className="sidebar-slot-panel"
            exit={{ opacity: 0, x: reduceMotion ? 0 : -8 }}
            initial={{ opacity: 0, x: reduceMotion ? 0 : 8 }}
            key={slotKey}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

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
