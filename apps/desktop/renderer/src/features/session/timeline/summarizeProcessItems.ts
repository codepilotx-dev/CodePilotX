import type { Item, TurnStatus } from "@codepilotx/shared/thread";

import {
  buildToolSemanticSummary,
  type ToolSemanticKind,
} from "./ToolActivityPresentation.js";

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
type AggregateKind =
  | "integration"
  | "loaded-tool"
  | "tool"
  | "file-change"
  | "stopped-file-creation"
  | "exploration"
  | "command"
  | "web-search"
  | "dynamic-tool";

type Aggregate = {
  key: string;
  kind: AggregateKind;
  label: string;
  semanticKind: ToolSemanticKind;
};

const AGGREGATE_ORDER: readonly AggregateKind[] = [
  "integration",
  "loaded-tool",
  "tool",
  "file-change",
  "stopped-file-creation",
  "exploration",
  "command",
  "web-search",
  "dynamic-tool",
];

function itemActivity(item: Item): ItemActivity {
  switch (item.type) {
    case "tool":
      if (item.state === "error" || item.state === "interrupted") return "failed";
      if (item.state === "pending" || item.state === "waiting-permission" || item.state === "running") return "running";
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
      if (item.status === "running" || item.status === "queued" || item.status === "preparing" || item.status === "steering") return "running";
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
      const value = buildToolSemanticSummary(item, { nowMs: Date.now() });
      return { kind: value.kind, label: value.collapsedLabel };
    }
    case "reasoning":
      return { kind: "thinking", label: "正在思考" };
    case "activity":
      return {
        kind: item.activity === "file-edit" ? "file-change" : item.activity === "build" ? "command" : "thinking",
        label: item.title.trim() || "正在处理",
      };
    case "subagent":
      return { kind: "tool", label: "正在处理子代理" };
    case "text":
    default:
      return { kind: "thinking", label: "正在处理" };
  }
}

const aggregateForTool = (item: Extract<Item, { type: "tool" }>): Aggregate => {
  const descriptor = item.activity;
  if (descriptor?.type === "integration") {
    const source = descriptor.source?.trim();
    return {
      key: `integration:${source ?? "unknown"}`,
      kind: "integration",
      label: source ? `使用了 ${source}` : "使用了集成",
      semanticKind: "integration",
    };
  }
  if (descriptor?.type === "read" && descriptor.subject === "skill"
    || descriptor?.type === "tool" && descriptor.mode === "load") {
    return { key: "loaded-tool", kind: "loaded-tool", label: "加载了工具", semanticKind: "loaded-tool" };
  }
  if (descriptor?.type === "file_change") {
    const stoppedCreate = item.state === "interrupted"
      && descriptor.changes.some((change) => change.operation === "create");
    return stoppedCreate
      ? { key: "stopped-file-creation", kind: "stopped-file-creation", label: "停止创建了文件", semanticKind: "file-change" }
      : { key: "file-change", kind: "file-change", label: "编辑了文件", semanticKind: "file-change" };
  }
  if (descriptor?.type === "tool") {
    const unnamed = descriptor.mode === "call" && !descriptor.name;
    return unnamed
      ? { key: "tool", kind: "tool", label: "调用了工具", semanticKind: "tool" }
      : { key: "dynamic-tool", kind: "dynamic-tool", label: "调用了工具", semanticKind: "tool" };
  }
  const value = buildToolSemanticSummary(item);
  switch (value.kind) {
    case "exploration":
      return { key: "exploration", kind: "exploration", label: "读取了文件", semanticKind: "exploration" };
    case "command":
      return { key: "command", kind: "command", label: "运行了命令", semanticKind: "command" };
    case "web-search":
      return { key: "web-search", kind: "web-search", label: "搜索了网页", semanticKind: "web-search" };
    case "file-change":
      return { key: "file-change", kind: "file-change", label: "编辑了文件", semanticKind: "file-change" };
    case "integration":
      return { key: "integration:unknown", kind: "integration", label: "使用了集成", semanticKind: "integration" };
    case "loaded-tool":
      return { key: "loaded-tool", kind: "loaded-tool", label: "加载了工具", semanticKind: "loaded-tool" };
    case "tool":
      return { key: "tool", kind: "tool", label: "调用了工具", semanticKind: "tool" };
  }
};

function completedAggregates(items: readonly Item[]): Aggregate[] {
  const values = new Map<string, Aggregate>();
  for (const item of items) {
    if (item.type === "tool") {
      const value = aggregateForTool(item);
      values.set(value.key, value);
      continue;
    }
    if (item.type === "activity" && item.activity === "file-edit") {
      values.set("file-change", { key: "file-change", kind: "file-change", label: "编辑了文件", semanticKind: "file-change" });
    }
    if (item.type === "activity" && item.activity === "build") {
      values.set("command", { key: "command", kind: "command", label: "运行了命令", semanticKind: "command" });
    }
    if (item.type === "subagent") {
      values.set("tool", { key: "tool", kind: "tool", label: "调用了工具", semanticKind: "tool" });
    }
  }
  return [...values.values()].sort((left, right) =>
    AGGREGATE_ORDER.indexOf(left.kind) - AGGREGATE_ORDER.indexOf(right.kind));
}

export function summarizeTurnProcessItems(
  items: readonly Item[],
  turnStatus: TurnStatus,
): ProcessSummary {
  const reversedItems = [...items].reverse();
  const activeItem = reversedItems.find((item) => item.type === "tool" && isProcessItemActive(item))
    ?? reversedItems.find(isProcessItemActive);
  if (isActiveTurn(turnStatus)) {
    const value = activeItem
      ? activeItemSummary(activeItem)
      : { kind: "thinking" as const, label: "正在思考" };
    return {
      active: true,
      failed: false,
      kind: value.kind,
      label: value.label,
      summaryKey: `active:${activeItem?.id ?? "thinking"}:${value.label}`,
    };
  }

  const parts = completedAggregates(items);
  const failed = items.some((item) => itemActivity(item) === "failed");
  const label = parts.length > 0 ? parts.map((part) => part.label).join("、") : "已处理";
  return {
    active: false,
    failed,
    kind: parts[0]?.semanticKind ?? "tool",
    label,
    summaryKey: `completed:${failed ? "failed" : "ok"}:${parts.map((part) => part.key).join("|") || "processed"}`,
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
  if (turnStatus === "stopped" || turnStatus === "interrupted" || turnStatus === "cancelled") {
    return { kind: "stopped", label: elapsed ? `你在 ${elapsed} 后停止了` : "你停止了" };
  }
  if (isActiveTurn(turnStatus)) {
    return { kind: "working", label: elapsed ? `已处理 ${elapsed}` : "处理中" };
  }
  return { kind: "worked", label: elapsed ? `已处理 ${elapsed}` : "已处理" };
}
