import type { Item, TurnStatus } from "@codepilotx/shared/thread";

type ToolItem = Extract<Item, { type: "tool" }>;

export type ProcessSummary = {
  active: boolean;
  failed: boolean;
  label: string;
};

type ItemActivity = "running" | "completed" | "failed";

function itemActivity(item: Item): ItemActivity {
  switch (item.type) {
    case "tool":
      if (item.state === "error" || item.state === "interrupted") return "failed";
      if (
        item.state === "pending"
        || item.state === "waiting-permission"
        || item.state === "running"
      ) {
        return "running";
      }
      return "completed";
    case "reasoning":
      if (item.status === "interrupted") return "failed";
      return item.status === "streaming" ? "running" : "completed";
    case "activity":
      if (item.status === "error" || item.status === "interrupted") return "failed";
      return item.status === "running" ? "running" : "completed";
    case "text":
      if (item.status === "interrupted") return "failed";
      return item.status === "streaming" ? "running" : "completed";
    case "subagent":
      if (item.status === "stopped") return "failed";
      if (
        item.status === "running"
        || item.status === "queued"
        || item.status === "preparing"
        || item.status === "steering"
      ) {
        return "running";
      }
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

function isRunningTool(item: ToolItem): boolean {
  return (
    item.state === "pending"
    || item.state === "waiting-permission"
    || item.state === "running"
  );
}

function commandPreview(item: ToolItem): string {
  const source = item.command?.trim() || item.title.trim() || item.tool;
  return source.replace(/\s+/g, " ").trim();
}

export function formatProcessElapsed(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  if (totalSeconds <= 0) return "";

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainSeconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainSeconds > 0) parts.push(`${remainSeconds}s`);
  return parts.join(" ");
}

function withElapsed(label: string, elapsedSeconds: number): string {
  const elapsed = formatProcessElapsed(elapsedSeconds);
  return elapsed ? `${label} ${elapsed}` : label;
}

export function summarizeTurnProcessItems(
  items: readonly Item[],
  turnStatus: TurnStatus,
  elapsedSeconds: number,
): ProcessSummary {
  const activities = items.map(itemActivity);
  const hasRunningItem = activities.includes("running");

  if (isWaitingStatus(turnStatus)) {
    return { active: true, failed: false, label: "等待操作" };
  }
  if (turnStatus === "running" || hasRunningItem) {
    return { active: true, failed: false, label: "正在处理" };
  }
  if (turnStatus === "failed") {
    return {
      active: false,
      failed: true,
      label: withElapsed("处理失败", elapsedSeconds),
    };
  }
  if (
    turnStatus === "stopped"
    || turnStatus === "interrupted"
    || turnStatus === "cancelled"
  ) {
    return {
      active: false,
      failed: true,
      label: withElapsed("已中断", elapsedSeconds),
    };
  }
  return {
    active: false,
    failed: false,
    label: withElapsed("已处理", elapsedSeconds),
  };
}

/**
 * Summarise one consecutive command group for CanonicalProcessGroup.
 *
 * @returns `active` – the group should be expanded automatically.
 *          `failed` – at least one item ended in error.
 *          `label`  – concise Chinese summary string.
 */
export function summarizeCommandItems(
  items: readonly ToolItem[],
  turnStatus: TurnStatus,
): ProcessSummary {
  if (items.length === 0) {
    return { active: false, failed: false, label: "" };
  }

  const runningItems = items.filter(isRunningTool);
  const hasFailed = items.some(
    (item) => item.state === "error" || item.state === "interrupted",
  );

  // Waiting states take priority — keep visible so the blocker is obvious.
  if (isWaitingStatus(turnStatus)) {
    return { active: true, failed: hasFailed, label: "等待操作" };
  }

  if (runningItems.length > 0) {
    return {
      active: true,
      failed: hasFailed,
      label: runningItems.length === 1
        ? `正在运行 ${commandPreview(runningItems[0])}`
        : `正在运行 ${runningItems.length} 条命令`,
    };
  }

  return {
    active: false,
    failed: hasFailed,
    label: `运行了 ${items.length} 条命令`,
  };
}
