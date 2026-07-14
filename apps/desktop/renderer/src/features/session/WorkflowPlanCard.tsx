import React from "react";
import { Maximize2, PanelRight } from "lucide-react";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { MarkdownMessage } from "./MarkdownMessage.js";

export function WorkflowPlanCard({
  summary,
  streaming,
  isDocked,
  onOpenInRightDock,
}: {
  summary: string;
  streaming: boolean;
  isDocked: boolean;
  onOpenInRightDock: () => void;
}): React.ReactNode {
  const title = planTitleFromSummary(summary);
  const presentation = planCardPresentation({ streaming, isDocked });

  if (presentation.compact) {
    return (
      <article className="workflow-plan-card workflow-plan-card--compact">
        <button
          className="workflow-plan-card__compact-button"
          type="button"
          onClick={onOpenInRightDock}
        >
          <span className="workflow-plan-card__label">
            {presentation.label}
          </span>
          <span className="workflow-plan-card__compact-title">{title}</span>
          <PanelRight
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </button>
      </article>
    );
  }

  return (
    <article className="workflow-plan-card">
      <header className="workflow-plan-card__header">
        <span className="workflow-plan-card__label">{presentation.label}</span>
        <div className="workflow-plan-card__actions">
          {presentation.showOpenInRightDock ? (
            <button
              aria-label="在右侧打开计划"
              className="workflow-plan-card__dock"
              title="在右侧打开计划"
              type="button"
              onClick={onOpenInRightDock}
            >
              <Maximize2
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </button>
          ) : null}
        </div>
      </header>

      <h2 className="workflow-plan-card__title">{title}</h2>

      <div className="workflow-plan-card__body">
        <MarkdownMessage text={summary} />
      </div>
    </article>
  );
}

export function planTitleFromSummary(summary: string): string {
  const heading = summary.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const proposedTitle = summary.match(/^\s*title:\s*(.+)$/im)?.[1]?.trim();
  return proposedTitle || "计划书";
}

export function planCardPresentation({
  streaming,
  isDocked,
}: {
  streaming: boolean;
  isDocked: boolean;
}): {
  compact: boolean;
  label: string;
  showOpenInRightDock: boolean;
  showFoldControls: boolean;
} {
  return {
    compact: isDocked,
    label: streaming ? "编写计划" : "计划",
    showOpenInRightDock: !streaming,
    showFoldControls: false,
  };
}
