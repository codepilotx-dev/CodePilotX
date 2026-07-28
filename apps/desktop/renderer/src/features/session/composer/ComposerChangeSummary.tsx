import React from "react";
import { CircleX } from "lucide-react";
import type { ExecutionPlanItem } from "@codepilotx/shared/thread";

import { Button } from "../../../components/ui/Button.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { ExecutionPlanCard } from "../workflow/ExecutionPlanCard.js";

type ComposerChangeSummaryProps = {
  executionPlan: ExecutionPlanItem | null;
  active: boolean;
  failed: boolean;
  changedFileCount: number;
  additions: number;
  deletions: number;
  onOpenReview: () => void;
};

const PLAN_PREVIEW_CLOSE_DELAY_MS = 120;

export function ComposerChangeSummary({
  executionPlan,
  active,
  failed,
  changedFileCount,
  additions,
  deletions,
  onOpenReview,
}: ComposerChangeSummaryProps): React.ReactNode {
  const planPanelId = React.useId();
  const [expandedPlanId, setExpandedPlanId] = React.useState<string | null>(
    null,
  );
  const planButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (closeTimerRef.current === null) return;
      window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  if (!executionPlan && changedFileCount <= 0) return null;

  function clearPlanPreviewCloseTimer(): void {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function openPlanPreview(planId: string): void {
    clearPlanPreviewCloseTimer();
    setExpandedPlanId(planId);
  }

  function schedulePlanPreviewClose(): void {
    clearPlanPreviewCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setExpandedPlanId(null);
    }, PLAN_PREVIEW_CLOSE_DELAY_MS);
  }

  function schedulePlanPreviewCloseUnlessFocused(): void {
    if (document.activeElement === planButtonRef.current) return;
    schedulePlanPreviewClose();
  }

  function openReview(): void {
    clearPlanPreviewCloseTimer();
    setExpandedPlanId(null);
    onOpenReview();
  }

  const currentStep = executionPlan
    ? executionPlanStepPosition(executionPlan)
    : 0;
  const planExpanded =
    executionPlan !== null && expandedPlanId === executionPlan.id;
  const formattedAdditions = formatSummaryNumber(additions);
  const formattedDeletions = formatSummaryNumber(deletions);

  return (
    <div className="composer-change-summary">
      {executionPlan ? (
        <div
          aria-hidden={!planExpanded}
          aria-label="执行计划"
          className="composer-change-summary__plan-preview"
          hidden={!planExpanded}
          id={planPanelId}
          role="region"
          onPointerEnter={clearPlanPreviewCloseTimer}
          onPointerLeave={schedulePlanPreviewCloseUnlessFocused}
        >
          <ExecutionPlanCard item={executionPlan} />
        </div>
      ) : null}
      <div
        aria-label="任务变更摘要"
        className="composer-change-summary__bar"
        role="group"
      >
        {executionPlan ? (
          <Button
            aria-controls={planPanelId}
            aria-expanded={planExpanded}
            className="composer-change-summary__plan"
            ref={planButtonRef}
            onBlur={schedulePlanPreviewClose}
            onFocus={() => openPlanPreview(executionPlan.id)}
            onPointerEnter={() => openPlanPreview(executionPlan.id)}
            onPointerLeave={schedulePlanPreviewCloseUnlessFocused}
          >
            <ExecutionPlanStatusIcon
              failed={failed}
              steps={executionPlan.steps}
              status={active ? "streaming" : executionPlan.status}
            />
            第 {currentStep} / {executionPlan.steps.length} 步
          </Button>
        ) : null}
        {executionPlan && changedFileCount > 0 ? (
          <span
            aria-hidden="true"
            className="composer-change-summary__separator"
          >
            ·
          </span>
        ) : null}
        {changedFileCount > 0 ? (
          <Button
            aria-label={`打开审阅面板，${changedFileCount} 个文件已更改，新增 ${formattedAdditions} 行，删除 ${formattedDeletions} 行`}
            className="composer-change-summary__changes"
            onClick={openReview}
          >
            {changedFileCount} 个文件已更改
            <span aria-hidden="true" className="composer-change-summary__diff">
              <strong>+{formattedAdditions}</strong>
              <em>-{formattedDeletions}</em>
            </span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function findLatestExecutionPlan(
  turns: readonly {
    executionPlanItems: readonly ExecutionPlanItem[];
  }[],
): ExecutionPlanItem | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const executionPlan = turns[index]?.executionPlanItems.at(-1);
    if (executionPlan) return executionPlan;
  }
  return null;
}

export function executionPlanStepPosition(item: ExecutionPlanItem): number {
  const total = item.steps.length;
  if (total === 0) return 0;

  const activeIndex = item.steps.findIndex(
    (step) => step.status === "in_progress",
  );
  if (activeIndex >= 0) return activeIndex + 1;
  if (item.status === "completed") return total;

  const completed = item.steps.filter(
    (step) => step.status === "completed",
  ).length;
  return Math.min(Math.max(completed + 1, 1), total);
}

function ExecutionPlanStatusIcon({
  failed,
  steps,
  status,
}: {
  failed: boolean;
  steps: ExecutionPlanItem["steps"];
  status: ExecutionPlanItem["status"];
}): React.ReactNode {
  const totalSteps = steps.length;
  const completedSteps =
    status === "completed"
      ? totalSteps
      : steps.filter((step) => step.status === "completed").length;
  const progress =
    totalSteps === 0
      ? 0
      : Math.round((completedSteps / totalSteps) * 10_000) / 100;
  const lifecycleLabel = failed
    ? "执行计划出错"
    : status === "streaming"
      ? "执行计划进行中"
      : status === "completed"
        ? "执行计划已完成"
        : "执行计划已中断";

  return (
    <span
      aria-label={`${lifecycleLabel}，已完成 ${completedSteps} / ${totalSteps} 步`}
      className={`composer-change-summary__plan-icon${
        failed ? " composer-change-summary__plan-icon--error" : ""
      }`}
      data-progress={failed ? undefined : progress}
      role="img"
    >
      {failed ? (
        <CircleX
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      ) : (
        <svg
          aria-hidden="true"
          className="composer-change-summary__plan-progress-ring"
          height={APP_ICON_SIZE}
          viewBox="0 0 20 20"
          width={APP_ICON_SIZE}
        >
          <circle
            className="composer-change-summary__plan-progress-track"
            cx="10"
            cy="10"
            fill="none"
            pathLength="100"
            r="8"
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          <circle
            className="composer-change-summary__plan-progress-value"
            cx="10"
            cy="10"
            fill="none"
            pathLength="100"
            r="8"
            strokeDasharray="100"
            strokeDashoffset={100 - progress}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </svg>
      )}
    </span>
  );
}

function formatSummaryNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
