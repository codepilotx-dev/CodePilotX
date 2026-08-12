import type { Item, TurnStatus } from "@codepilotx/shared/thread";

import {
  buildToolSemanticSummary,
  type ToolSemanticKind,
} from "./CanonicalItemRenderer.js";

export type ProcessSemanticKind = ToolSemanticKind | "thinking" | "failed";

export type ProcessSummary = {
  active: boolean;
  failed: boolean;
  kind: ProcessSemanticKind;
  label: string;
  summaryKey: string;
};

export type TurnWorkSummary = {
  kind: "working" | "worked" | "stopped";
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

export function isProcessItemActive(item: Item): boolean {
  return itemActivity(item) === "running";
}

function isActiveTurn(status: TurnStatus): boolean {
  return status === "running"
    || status === "waiting-permission"
    || status === "waiting-question"
    || status === "waiting-subagents";
}

function activeItemSummary(item: Item): Pick<ProcessSummary, "kind" | "label"> {
  switch (item.type) {
    case "tool": {
      const summary = buildToolSemanticSummary(item);
      return { kind: summary.kind, label: summary.collapsedLabel };
    }
    case "reasoning":
      return { kind: "thinking", label: "正在思考" };
    case "activity":
      return {
        kind: item.activity === "file-edit"
          ? "file-change"
          : item.activity === "build"
            ? "command"
            : "thinking",
        label: item.title.trim() || "正在处理",
      };
    case "subagent":
      return { kind: "tool", label: "正在处理子代理" };
    case "text":
      return { kind: "thinking", label: "正在处理" };
    default:
      return { kind: "thinking", label: "正在处理" };
  }
}

function semanticCount(item: Item, kind: ToolSemanticKind): number {
  if (kind !== "file-change" || item.type !== "tool") return 1;
  return item.mutationDiffPaths && item.mutationDiffPaths.length > 0
    ? item.mutationDiffPaths.length
    : 1;
}

function completedSemanticKinds(
  items: readonly Item[],
): Array<{ count: number; kind: ToolSemanticKind }> {
  const counts = new Map<ToolSemanticKind, number>();
  const add = (kind: ToolSemanticKind, count = 1): void => {
    counts.set(kind, (counts.get(kind) ?? 0) + count);
  };

  for (const item of items) {
    if (item.type === "tool") {
      const { kind } = buildToolSemanticSummary(item);
      add(kind, semanticCount(item, kind));
      continue;
    }
    if (item.type === "activity") {
      if (item.activity === "file-edit") add("file-change");
      if (item.activity === "build") add("command");
      continue;
    }
    if (item.type === "subagent") add("tool");
  }

  return [...counts].map(([kind, count]) => ({ count, kind }));
}

function completedSemanticLabel(kind: ToolSemanticKind, count: number): string {
  switch (kind) {
    case "file-change":
      return count === 1 ? "编辑了一个文件" : "编辑了文件";
    case "exploration":
      return "已读取文件";
    case "command":
      return "运行了命令";
    case "web-search":
      return "已搜索网页";
    case "integration":
      return "使用了集成";
    case "tool":
      return "调用了工具";
  }
}

export function summarizeTurnProcessItems(
  items: readonly Item[],
  turnStatus: TurnStatus,
): ProcessSummary {
  const activeItem = [...items].reverse().find(isProcessItemActive);
  if (isActiveTurn(turnStatus)) {
    const summary = activeItem
      ? activeItemSummary(activeItem)
      : { kind: "thinking" as const, label: "正在思考" };
    return {
      active: true,
      failed: false,
      kind: summary.kind,
      label: summary.label,
      summaryKey: `active:${activeItem?.id ?? "thinking"}:${summary.label}`,
    };
  }

  const parts = completedSemanticKinds(items);
  const label = parts.length > 0
    ? parts.map(({ count, kind }) => completedSemanticLabel(kind, count)).join("、")
    : "已处理";
  const kind = parts[0]?.kind ?? "tool";
  return {
    active: false,
    failed: false,
    kind,
    label,
    summaryKey: `completed:${parts.map(({ count, kind }) => `${kind}:${count}`).join("|") || "processed"}`,
  };
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

export function summarizeTurnWork(
  turnStatus: TurnStatus,
  elapsedSeconds: number,
): TurnWorkSummary | null {
  if (turnStatus === "queued") return null;
  const elapsed = formatProcessElapsed(elapsedSeconds);
  if (
    turnStatus === "stopped"
    || turnStatus === "interrupted"
    || turnStatus === "cancelled"
  ) {
    return {
      kind: "stopped",
      label: elapsed ? `你在 ${elapsed} 后停止了` : "你停止了",
    };
  }
  if (isActiveTurn(turnStatus)) {
    return {
      kind: "working",
      label: elapsed ? `已处理 ${elapsed}` : "处理中",
    };
  }
  return {
    kind: "worked",
    label: elapsed ? `已处理 ${elapsed}` : "已处理",
  };
}
