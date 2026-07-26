import type { Item, TurnStatus } from "@codepilotx/shared/thread";

export type ProcessSummary = {
  active: boolean;
  failed: boolean;
  label: string;
};

/**
 * Classify a process item as "running", "completed", or "failed".
 */
function itemActivity(
  item: Item,
): "running" | "completed" | "failed" {
  switch (item.type) {
    case "tool":
      if (item.state === "error" || item.state === "interrupted") return "failed";
      if (item.state === "pending" || item.state === "waiting-permission" || item.state === "running") return "running";
      return "completed";
    case "reasoning":
      if (item.status === "interrupted") return "failed";
      if (item.status === "streaming") return "running";
      return "completed";
    case "activity":
      if (item.status === "error" || item.status === "interrupted") return "failed";
      if (item.status === "running") return "running";
      return "completed";
    case "text":
      if (item.status === "streaming") return "running";
      return "completed";
    case "subagent":
      if (item.status === "stopped") return "failed";
      if (item.status === "running" || item.status === "queued" || item.status === "preparing" || item.status === "steering") return "running";
      return "completed";
    default:
      return "completed";
  }
}

/**
 * Tell whether a turn status should keep the process group expanded
 * because the user's action is needed.
 */
function isWaitingStatus(status: TurnStatus): boolean {
  return (
    status === "waiting-permission" ||
    status === "waiting-question" ||
    status === "waiting-subagents"
  );
}

/**
 * Format elapsed seconds into a concise Chinese label.
 */
function formatElapsed(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 60) return `执行了 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (remainSec === 0) return `执行了 ${minutes} 分钟`;
  return `执行了 ${minutes} 分 ${remainSec} 秒`;
}

/**
 * Summarise a turn's process items into a single state for CanonicalProcessGroup.
 *
 * @returns `active` – the group should be expanded automatically.
 *          `failed` – at least one item ended in error.
 *          `label`  – concise Chinese summary string.
 */
export function summarizeProcessItems(
  items: Item[],
  turnStatus: TurnStatus,
  elapsedSeconds: number,
): ProcessSummary {
  if (items.length === 0) {
    // No process items – the turn may still be active (fallback thinking).
    if (isWaitingStatus(turnStatus)) {
      return { active: true, failed: false, label: "等待操作" };
    }
    return { active: false, failed: false, label: "" };
  }

  // Scan all items for the most severe state.
  let hasRunning = false;
  let hasFailed = false;
  let hasCompleted = false;

  for (const item of items) {
    const act = itemActivity(item);
    if (act === "failed") hasFailed = true;
    else if (act === "running") hasRunning = true;
    else hasCompleted = true;
  }

  // Waiting states take priority — keep visible so the blocker is obvious.
  if (isWaitingStatus(turnStatus)) {
    return { active: true, failed: false, label: "等待操作" };
  }

  if (hasFailed) {
    return { active: false, failed: true, label: "执行出错" };
  }

  if (hasRunning) {
    return { active: true, failed: false, label: "正在思考" };
  }

  // All completed — prefer elapsed time, fall back to item count.
  const elapsed = formatElapsed(elapsedSeconds);
  if (elapsed) {
    return { active: false, failed: false, label: elapsed };
  }
  return { active: false, failed: false, label: `${items.length} 项活动` };
}
