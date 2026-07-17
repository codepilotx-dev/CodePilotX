import React from "react";
import { Tooltip } from "../../components/ui/Tooltip.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import type { ConversationTurnNavItem } from "./ConversationPage.js";

type Props = {
  items: ConversationTurnNavItem[];
  onNavigate: (rowIndex: number) => void;
};

const MIN_TURN_NAV_INLINE_CLEARANCE_PX = 88;

/**
 * Render a vertical "turn navigation" rail on the left edge of the session
 * timeline.  Each tick represents one user turn; clicking it scrolls the
 * virtual list to that turn's user-message row.
 *
 * The rail is an overlay sibling of `.workflow-main-scroll-area`, so it stays
 * fixed while the thread content scrolls underneath it.
 */

function formatFilesLabel(files: string[]): string | null {
  if (files.length === 0) return null;
  const display = files.slice(0, 2);
  const label = display.map((f) => {
    // Show just the filename (last path segment)
    const parts = f.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] ?? f;
  });
  if (files.length > 2) {
    label.push(`+${files.length - 2}`);
  }
  return label.join(" · ");
}

export function ConversationTurnNavRail({
  items,
  onNavigate,
}: Props): React.ReactNode {
  const railRef = React.useRef<HTMLElement | null>(null);
  const [hasInlineClearance, setHasInlineClearance] = React.useState(false);

  React.useLayoutEffect(() => {
    const rail = railRef.current;
    const frame = rail?.parentElement;
    if (!rail || !frame) return;

    const content =
      frame.querySelector<HTMLElement>(".session-timeline-container") ??
      frame.querySelector<HTMLElement>(".workflow-page__composer-inner");
    if (!content) return;

    const updateVisibility = (): void => {
      const frameRect = frame.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const inlineClearance = contentRect.left - frameRect.left;
      setHasInlineClearance(
        inlineClearance >= MIN_TURN_NAV_INLINE_CLEARANCE_PX,
      );
    };

    updateVisibility();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateVisibility);
    observer?.observe(frame);
    observer?.observe(content);
    window.addEventListener("resize", updateVisibility);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateVisibility);
    };
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <nav
      aria-hidden={!hasInlineClearance}
      aria-label="对话轮次导航"
      className="conversation-turn-nav-rail"
      data-visible={hasInlineClearance}
      ref={railRef}
    >
      {items.map((item) => (
        <Tooltip
          key={item.id}
          side="right"
          sideOffset={8}
          delayDuration={700}
          content={
            <div className="conversation-turn-preview-card">
              <div className="preview-card-user-text">{item.userText}</div>
              {item.assistantText ? (
                <div className="preview-card-assistant-text">
                  <MarkdownMessage text={item.assistantText} />
                </div>
              ) : null}
              {item.files.length > 0 ? (
                <div className="preview-card-files">
                  <span className="preview-card-files-icon">文件 </span>
                  {formatFilesLabel(item.files)}
                </div>
              ) : null}
            </div>
          }
        >
          <button
            type="button"
            className="conversation-turn-nav-item"
            onClick={() => onNavigate(item.rowIndex)}
            aria-label={`跳转到第 ${items.indexOf(item) + 1} 轮对话`}
            tabIndex={hasInlineClearance ? 0 : -1}
          />
        </Tooltip>
      ))}
    </nav>
  );
}
