import React from "react";
import { ArrowDown, Check, CircleX, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { ExecutionPlanItem } from "@codepilotx/shared/thread";

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";
import {
  enterTween,
  exitTween,
  fastTween,
  instantTween,
  motionTransition,
  standardTween,
} from "../../motion/motionTransitions.js";
import { ExecutionPlanCard } from "../workflow/ExecutionPlanCard.js";
import type { ConversationChangedFile } from "./conversationChangeSummary.js";

type ComposerChangeSummaryProps = {
  executionPlan: ExecutionPlanItem | null;
  active: boolean;
  failed: boolean;
  changedFiles: readonly ConversationChangedFile[];
  additions: number | null;
  deletions: number | null;
  canReturnToBottom: boolean;
  onOpenReview: () => void;
  onOpenReviewFile: (path: string) => void;
  onReturnToBottom: () => void;
};

const PLAN_PREVIEW_CLOSE_DELAY_MS = 120;
const RETURN_BUTTON_ENTER_DELAY_SECONDS = 0.16;

type ComposerPlanLifecycle = ExecutionPlanItem["status"] | "failed";
type ComposerSummaryPreview =
  | { kind: "plan"; planId: string }
  | { kind: "files" }
  | null;

export function ComposerChangeSummary({
  executionPlan,
  active,
  failed,
  changedFiles,
  additions,
  deletions,
  canReturnToBottom,
  onOpenReview,
  onOpenReviewFile,
  onReturnToBottom,
}: ComposerChangeSummaryProps): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion();
  const planPanelId = React.useId();
  const filesPanelId = React.useId();
  const [activePreview, setActivePreview] = React.useState<ComposerSummaryPreview>(
    null,
  );
  const summaryRef = React.useRef<HTMLDivElement | null>(null);
  const planButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const changesButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (closeTimerRef.current === null) return;
      window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const changedFileCount = changedFiles.length;
  if (!executionPlan && changedFileCount <= 0) return null;

  function clearPreviewCloseTimer(): void {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function openPlanPreview(planId: string): void {
    clearPreviewCloseTimer();
    setActivePreview({ kind: "plan", planId });
  }

  function openFilesPreview(): void {
    clearPreviewCloseTimer();
    setActivePreview({ kind: "files" });
  }

  function schedulePreviewClose(): void {
    clearPreviewCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setActivePreview(null);
    }, PLAN_PREVIEW_CLOSE_DELAY_MS);
  }

  function schedulePreviewCloseUnlessFocused(): void {
    const activeElement = document.activeElement;
    if (
      activeElement === planButtonRef.current ||
      activeElement === changesButtonRef.current ||
      planButtonRef.current?.matches(":hover") ||
      changesButtonRef.current?.matches(":hover") ||
      summaryRef.current?.querySelector(
        ".composer-change-summary__files-card:hover",
      ) ||
      (activeElement instanceof HTMLElement &&
        activeElement.closest(".composer-change-summary__files-card"))
    ) {
      return;
    }
    schedulePreviewClose();
  }

  function openReview(): void {
    clearPreviewCloseTimer();
    setActivePreview(null);
    onOpenReview();
  }

  function openReviewFile(path: string): void {
    clearPreviewCloseTimer();
    setActivePreview(null);
    onOpenReviewFile(path);
  }

  const currentStep = executionPlan
    ? executionPlanStepPosition(executionPlan)
    : 0;
  const planExpanded =
    executionPlan !== null &&
    activePreview?.kind === "plan" &&
    activePreview.planId === executionPlan.id;
  const filesExpanded =
    changedFileCount > 0 && activePreview?.kind === "files";
  const diffStatsAvailable = additions !== null && deletions !== null;
  const formattedAdditions = formatSummaryNumber(additions ?? 0);
  const formattedDeletions = formatSummaryNumber(deletions ?? 0);
  const running = active && !failed;
  const planLifecycle: ComposerPlanLifecycle = failed
    ? "failed"
    : active
      ? "streaming"
      : executionPlan?.status ?? "interrupted";
  const planStatusText =
    planLifecycle === "completed"
      ? "已全部完成"
      : planLifecycle === "failed"
        ? "执行出错"
        : planLifecycle === "interrupted"
          ? "执行已中断"
          : executionPlan
            ? `第 ${currentStep} / ${executionPlan.steps.length} 步`
            : "";

  return (
    <div className="composer-change-summary" ref={summaryRef}>
      <AnimatePresence initial={false} mode="wait">
        {executionPlan && planExpanded ? (
          <ComposerPlanPreviewPresence
            key={`plan:${executionPlan.id}`}
            id={planPanelId}
            item={executionPlan}
            reducedMotion={reducedMotion}
            onPointerEnter={clearPreviewCloseTimer}
            onPointerLeave={schedulePreviewCloseUnlessFocused}
          />
        ) : filesExpanded ? (
          <ComposerChangedFilesPreviewPresence
            key="files"
            files={changedFiles}
            id={filesPanelId}
            reducedMotion={reducedMotion}
            onFocus={clearPreviewCloseTimer}
            onOpenFile={openReviewFile}
            onPointerEnter={clearPreviewCloseTimer}
            onPointerLeave={schedulePreviewCloseUnlessFocused}
            onRequestClose={schedulePreviewCloseUnlessFocused}
          />
        ) : null}
      </AnimatePresence>
      <motion.div
        className="composer-change-summary__bar-shell"
        layout="position"
        transition={motionTransition(reducedMotion, standardTween)}
      >
        <div
          aria-label="任务变更摘要"
          className="composer-change-summary__bar"
          role="group"
        >
          {executionPlan ? (
            <button type="button"
              aria-controls={planPanelId}
              aria-expanded={planExpanded}
              className="composer-change-summary__plan"
              ref={planButtonRef}
              onBlur={schedulePreviewClose}
              onFocus={() => openPlanPreview(executionPlan.id)}
              onPointerEnter={() => openPlanPreview(executionPlan.id)}
              onPointerLeave={schedulePreviewCloseUnlessFocused}
            >
              <ExecutionPlanStatusIcon
                steps={executionPlan.steps}
                status={planLifecycle}
              />
              {planStatusText}
            </button>
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
            <button type="button"
              aria-controls={filesPanelId}
              aria-expanded={filesExpanded}
              aria-label={diffStatsAvailable
                ? `打开审阅面板，${changedFileCount} 个文件已更改，新增 ${formattedAdditions} 行，删除 ${formattedDeletions} 行`
                : `打开审阅面板，${changedFileCount} 个文件已更改，增删行数统计暂不可用`}
              className="composer-change-summary__changes"
              ref={changesButtonRef}
              onBlur={schedulePreviewClose}
              onClick={openReview}
              onFocus={openFilesPreview}
              onPointerEnter={openFilesPreview}
              onPointerLeave={schedulePreviewCloseUnlessFocused}
            >
              {changedFileCount} 个文件已更改
              {diffStatsAvailable ? (
                <span
                  aria-hidden="true"
                  className="composer-change-summary__diff"
                >
                  <strong>+{formattedAdditions}</strong>
                  <em>-{formattedDeletions}</em>
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </motion.div>
      <AnimatePresence initial={false}>
        {canReturnToBottom ? (
          <ComposerReturnToBottomPresence
            key="return-to-bottom"
            onReturnToBottom={onReturnToBottom}
            reducedMotion={reducedMotion}
            running={running}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ComposerChangedFilesPreviewPresence({
  files,
  id,
  onFocus,
  onOpenFile,
  onPointerEnter,
  onPointerLeave,
  onRequestClose,
  reducedMotion,
}: {
  files: readonly ConversationChangedFile[];
  id: string;
  onFocus: () => void;
  onOpenFile: (path: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onRequestClose: () => void;
  reducedMotion: boolean;
}): React.ReactNode {
  const isPresent = useIsPresent();

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-hidden={!isPresent ? true : undefined}
      aria-label="修改文件"
      className="composer-change-summary__files-preview"
      data-presence={isPresent ? "present" : "exiting"}
      exit={{
        opacity: 0,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      id={id}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0 }}
      role="region"
      style={{ pointerEvents: isPresent ? undefined : "none" }}
      transition={motionTransition(reducedMotion, enterTween)}
      onBlurCapture={event => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        onRequestClose();
      }}
      onFocusCapture={onFocus}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="composer-change-summary__files-card">
        <div className="composer-change-summary__files-list" role="list">
          {files.map(file => {
            const statsAvailable =
              file.additions !== null && file.deletions !== null;
            const fileName = basenameOf(file.path);
            return (
              <div key={file.path} role="listitem">
                <button
                  aria-label={statsAvailable
                    ? `${file.path}，新增 ${file.additions} 行，删除 ${file.deletions} 行`
                    : `${file.path}，增删行数统计暂不可用`}
                  className="composer-change-summary__file-row"
                  title={file.path}
                  type="button"
                  onClick={() => onOpenFile(file.path)}
                >
                  <span className="composer-change-summary__file-name">
                    {fileName}
                  </span>
                  {statsAvailable ? (
                    <span
                      aria-hidden="true"
                      className="composer-change-summary__file-diff"
                    >
                      <strong>+{formatSummaryNumber(file.additions ?? 0)}</strong>
                      <em>-{formatSummaryNumber(file.deletions ?? 0)}</em>
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function ComposerPlanPreviewPresence({
  id,
  item,
  onPointerEnter,
  onPointerLeave,
  reducedMotion,
}: {
  id: string;
  item: ExecutionPlanItem;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  reducedMotion: boolean;
}): React.ReactNode {
  const isPresent = useIsPresent();

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-hidden={!isPresent ? true : undefined}
      aria-label="执行计划"
      className="composer-change-summary__plan-preview"
      data-presence={isPresent ? "present" : "exiting"}
      exit={{
        opacity: 0,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      id={id}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0 }}
      role="region"
      style={{ pointerEvents: isPresent ? undefined : "none" }}
      transition={motionTransition(reducedMotion, enterTween)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <ExecutionPlanCard item={item} />
    </motion.div>
  );
}

function ComposerReturnToBottomPresence({
  onReturnToBottom,
  reducedMotion,
  running,
}: {
  onReturnToBottom: () => void;
  reducedMotion: boolean;
  running: boolean;
}): React.ReactNode {
  const isPresent = useIsPresent();
  const [entryComplete, setEntryComplete] = React.useState(reducedMotion);
  const presenceRef = React.useRef<HTMLDivElement | null>(null);
  const interactive = isPresent && entryComplete;

  React.useLayoutEffect(() => {
    if (isPresent) return;
    setEntryComplete(false);
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      presenceRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }, [isPresent]);

  React.useEffect(() => {
    if (reducedMotion && isPresent) setEntryComplete(true);
  }, [isPresent, reducedMotion]);

  return (
    <motion.div
      ref={presenceRef}
      animate={{ opacity: 1, scale: 1 }}
      aria-hidden={!interactive ? true : undefined}
      className="composer-change-summary__return-presence"
      exit={{
        opacity: 0,
        scale: 0.72,
        transition: motionTransition(reducedMotion, fastTween),
      }}
      inert={!interactive ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.72 }}
      onAnimationComplete={() => {
        if (isPresent) setEntryComplete(true);
      }}
      transition={
        reducedMotion
          ? instantTween
          : {
              ...standardTween,
              delay: RETURN_BUTTON_ENTER_DELAY_SECONDS,
            }
      }
    >
      <button
        aria-label="回到底部"
        className="composer-change-summary__return"
        data-running={running || undefined}
        onClick={onReturnToBottom}
        title="回到底部"
        type="button"
      >
        {running ? (
          <span
            aria-hidden="true"
            className="composer-change-summary__thinking-dots"
          >
            <span />
            <span />
            <span />
          </span>
        ) : null}
        <ArrowDown
          aria-hidden="true"
          className="composer-change-summary__down-arrow"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </button>
    </motion.div>
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
  steps,
  status,
}: {
  steps: ExecutionPlanItem["steps"];
  status: ComposerPlanLifecycle;
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
  const lifecycleLabel =
    status === "failed"
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
        status === "failed"
          ? " composer-change-summary__plan-icon--error"
          : status === "streaming"
            ? " composer-change-summary__plan-icon--running"
            : status === "completed"
              ? " composer-change-summary__plan-icon--completed"
              : ""
      }`}
      data-progress={status === "failed" ? undefined : progress}
      role="img"
    >
      {status === "failed" ? (
        <CircleX
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      ) : status === "streaming" ? (
        <LoaderCircle
          aria-hidden="true"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      ) : status === "completed" ? (
        <Check
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

function basenameOf(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
