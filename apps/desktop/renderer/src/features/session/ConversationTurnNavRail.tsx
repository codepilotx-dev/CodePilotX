import React from "react";
import { Tooltip } from "../../components/ui/Tooltip.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import type { ConversationTurnNavItem } from "./ConversationPage.js";

type Props = {
  items: ConversationTurnNavItem[];
  onNavigate: (rowIndex: number) => void;
};

/**
 * Render a vertical "turn navigation" rail on the left edge of the session
 * timeline.  Each tick represents one user turn; clicking it scrolls the
 * virtual list to that turn's user-message row.
 *
 * The rail is absolutely positioned inside `.session-timeline-wrapper`
 * so it overlays the timeline edge without affecting flex layout or scroll.
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
  if (items.length === 0) return null;

  return (
    <nav className="conversation-turn-nav-rail" aria-label="对话轮次导航">
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
          />
        </Tooltip>
      ))}
    </nav>
  );
}
