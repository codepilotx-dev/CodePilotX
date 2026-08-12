import { describe, expect, test } from "bun:test";
import type { Item } from "@codepilotx/shared/thread";

import {
  formatProcessElapsed,
  summarizeTurnProcessItems,
  summarizeTurnWork,
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

describe("summarizeTurnProcessItems", () => {
  test("combines semantic categories in first-seen order and removes duplicates", () => {
    const result = summarizeTurnProcessItems([
      toolItem({
        command: null,
        input: { file_path: "src/a.ts" },
        mutationDiffPaths: ["src/a.ts", "src/b.ts"],
        state: "completed",
        tool: "Edit",
      }, "edit-1"),
      toolItem({ command: null, input: { file_path: "src/a.ts" }, state: "completed", tool: "Read" }, "read-1"),
      toolItem({ command: null, input: { pattern: "needle" }, state: "completed", tool: "Grep" }, "grep-1"),
      toolItem({ state: "completed" }, "command-1"),
      toolItem({ command: null, state: "completed", tool: "web__run" }, "web-1"),
      toolItem({ command: null, state: "completed", tool: "mcp__drive__search" }, "mcp-1"),
      toolItem({ command: null, state: "completed", tool: "custom_tool" }, "other-1"),
    ], "completed");

    expect(result).toMatchObject({
      active: false,
      failed: false,
      kind: "file-change",
      label: "编辑了文件、已读取文件、运行了命令、已搜索网页、使用了集成、调用了工具",
    });
  });

  test("uses the singular file label and a safe fallback", () => {
    expect(summarizeTurnProcessItems([
      toolItem({ command: null, input: { file_path: "src/a.ts" }, state: "completed", tool: "Write" }),
    ], "completed")).toMatchObject({
      kind: "file-change",
      label: "编辑了一个文件",
    });

    const text = {
      id: "text-1",
      type: "text",
      status: "completed",
    } as unknown as Item;
    expect(summarizeTurnProcessItems([text], "completed")).toMatchObject({
      kind: "tool",
      label: "已处理",
    });
  });

  test("uses the latest active item for a running summary", () => {
    const result = summarizeTurnProcessItems([
      toolItem({ state: "running" }, "command-1"),
      toolItem({
        command: null,
        input: { file_path: "src/foo.ts" },
        state: "running",
        tool: "Read",
      }, "read-1"),
    ], "running");

    expect(result).toMatchObject({
      active: true,
      failed: false,
      kind: "exploration",
      label: "正在读取 src/foo.ts",
    });
    expect(result.summaryKey).toContain("read-1");

    const completedReasoning = {
      id: "reasoning-1",
      type: "reasoning",
      text: "分析下一步",
      status: "completed",
    } as unknown as Item;
    expect(summarizeTurnProcessItems(
      [completedReasoning],
      "running",
    )).toMatchObject({
      active: true,
      kind: "thinking",
      label: "正在思考",
    });
  });

  test("keeps child failures in detail rows instead of promoting them to a group failure", () => {
    expect(summarizeTurnProcessItems([
      toolItem({ error: "failed", state: "error" }),
      toolItem({ state: "completed" }, "command-2"),
    ], "completed")).toMatchObject({
      active: false,
      failed: false,
      kind: "command",
      label: "运行了命令",
    });
  });
});

describe("turn work status", () => {
  test("formats compact elapsed time", () => {
    expect(formatProcessElapsed(12)).toBe("12s");
    expect(formatProcessElapsed(300)).toBe("5m");
    expect(formatProcessElapsed(359)).toBe("5m 59s");
    expect(formatProcessElapsed(3_723)).toBe("1h 2m 3s");
    expect(formatProcessElapsed(0)).toBe("");
  });

  test("uses Codex working, completed and stopped copy", () => {
    expect(summarizeTurnWork("running", 0)).toEqual({
      kind: "working",
      label: "处理中",
    });
    expect(summarizeTurnWork("running", 12)).toEqual({
      kind: "working",
      label: "已处理 12s",
    });
    expect(summarizeTurnWork("completed", 359)).toEqual({
      kind: "worked",
      label: "已处理 5m 59s",
    });
    expect(summarizeTurnWork("stopped", 84)).toEqual({
      kind: "stopped",
      label: "你在 1m 24s 后停止了",
    });
  });
});
