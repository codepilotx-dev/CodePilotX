import { describe, expect, test } from "bun:test";
import type { Item } from "@codepilotx/shared/thread";

import {
  formatProcessElapsed,
  summarizeCommandItems,
  summarizeTurnProcessItems,
} from "../src/features/session/timeline/summarizeProcessItems.js";

type ToolItem = Extract<Item, { type: "tool" }>;

function toolItem(
  overrides: Partial<ToolItem> & Pick<ToolItem, "state">,
  id = "tool-1",
): ToolItem {
  return {
    id,
    messageID: id,
    turnId: "turn-1",
    agentId: "agent-1",
    type: "tool",
    callID: `call-${id}`,
    tool: "Bash",
    title: "运行命令",
    input: null,
    command: "bun test",
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: 0,
    ...overrides,
  };
}

describe("summarizeCommandItems", () => {
  test("completed command groups report command count instead of turn duration", () => {
    const result = summarizeCommandItems(
      [
        toolItem({ state: "completed" }, "tool-1"),
        toolItem({ state: "completed" }, "tool-2"),
      ],
      "completed",
    );

    expect(result).toEqual({
      active: false,
      failed: false,
      label: "运行了 2 条命令",
    });
  });

  test("one running command uses a single-line command preview", () => {
    const result = summarizeCommandItems(
      [toolItem({ state: "running", command: "bun test\n--watch" })],
      "running",
    );

    expect(result).toEqual({
      active: true,
      failed: false,
      label: "正在运行 bun test --watch",
    });
  });

  test("concurrent running commands use the running command count", () => {
    const result = summarizeCommandItems(
      [
        toolItem({ state: "running" }, "tool-1"),
        toolItem({ state: "pending" }, "tool-2"),
      ],
      "running",
    );

    expect(result.label).toBe("正在运行 2 条命令");
    expect(result.active).toBe(true);
  });

  test("terminal failures keep the command count and failed state", () => {
    const result = summarizeCommandItems(
      [
        toolItem({ state: "completed" }, "tool-1"),
        toolItem({ state: "error" }, "tool-2"),
        toolItem({ state: "interrupted" }, "tool-3"),
      ],
      "completed",
    );

    expect(result).toEqual({
      active: false,
      failed: true,
      label: "运行了 3 条命令",
    });
  });

  test("waiting turns keep the blocker visible", () => {
    const result = summarizeCommandItems(
      [toolItem({ state: "waiting-permission" })],
      "waiting-permission",
    );

    expect(result).toEqual({
      active: true,
      failed: false,
      label: "等待操作",
    });
  });
});

describe("summarizeTurnProcessItems", () => {
  test("formats compact elapsed time for completed turns", () => {
    expect(formatProcessElapsed(12)).toBe("12s");
    expect(formatProcessElapsed(300)).toBe("5m");
    expect(formatProcessElapsed(359)).toBe("5m 59s");
    expect(formatProcessElapsed(3_723)).toBe("1h 2m 3s");
    expect(formatProcessElapsed(0)).toBe("");

    expect(summarizeTurnProcessItems(
      [toolItem({ state: "completed" })],
      "completed",
      359,
    )).toEqual({
      active: false,
      failed: false,
      label: "已处理 5m 59s",
    });
  });

  test("keeps active and waiting turns visible", () => {
    expect(summarizeTurnProcessItems(
      [toolItem({ state: "running" })],
      "running",
      12,
    )).toEqual({
      active: true,
      failed: false,
      label: "正在处理",
    });
    expect(summarizeTurnProcessItems(
      [toolItem({ state: "waiting-permission" })],
      "waiting-permission",
      12,
    )).toEqual({
      active: true,
      failed: false,
      label: "等待操作",
    });
  });

  test("failed and interrupted turns remain terminal and collapsed by default", () => {
    expect(summarizeTurnProcessItems(
      [toolItem({ state: "error" })],
      "failed",
      84,
    )).toEqual({
      active: false,
      failed: true,
      label: "处理失败 1m 24s",
    });
    expect(summarizeTurnProcessItems(
      [toolItem({ state: "interrupted" })],
      "interrupted",
      0,
    )).toEqual({
      active: false,
      failed: true,
      label: "已中断",
    });
  });
});
