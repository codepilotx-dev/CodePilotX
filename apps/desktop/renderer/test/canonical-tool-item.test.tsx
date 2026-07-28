import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Item } from "@codepilotx/shared/thread";

import {
  buildToolItemDisplay,
  ToolItemView,
  ToolExecutionCard,
} from "../src/features/session/timeline/CanonicalItemRenderer.js";
import { TooltipProvider } from "../src/components/ui/Tooltip.js";

type ToolItem = Extract<Item, { type: "tool" }>;

function toolItem(overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    id: "tool-1",
    messageID: "message-1",
    turnId: "turn-1",
    agentId: "agent-1",
    type: "tool",
    callID: "call-1",
    tool: "Bash",
    title: "运行命令",
    state: "completed",
    input: null,
    command: "bun test",
    output: "pass",
    error: null,
    startedAt: 1_000,
    finishedAt: 1_250,
    durationMs: 250,
    createdAt: 1_000,
    ...overrides,
  };
}

describe("canonical tool item display", () => {
  test("formats terminal duration and falls back when history has no timing", () => {
    expect(buildToolItemDisplay(toolItem()).expandedLabel).toBe("命令运行了 1 秒");
    expect(buildToolItemDisplay(toolItem({
      durationMs: 84_000,
      finishedAt: 85_000,
    })).expandedLabel).toBe("命令运行了 1 分 24 秒");
    expect(buildToolItemDisplay(toolItem({
      durationMs: null,
      startedAt: null,
      finishedAt: null,
    })).expandedLabel).toBe("命令已运行");
  });

  test("only allows an active command to expand after output arrives", () => {
    expect(buildToolItemDisplay(toolItem({
      state: "running",
      durationMs: null,
      finishedAt: null,
      output: "   ",
    })).canExpand).toBe(false);
    expect(buildToolItemDisplay(toolItem({
      state: "running",
      durationMs: null,
      finishedAt: null,
      output: "partial output",
    }))).toMatchObject({
      canExpand: true,
      collapsedLabel: "正在运行 bun test",
      expandedLabel: "命令正在运行",
      resultText: "partial output",
    });
  });

  test("combines output and error without leaking apply-patch input", () => {
    const result = buildToolItemDisplay(toolItem({
      tool: "workspace.apply_patch",
      title: "应用补丁",
      command: null,
      input: {
        patch: "*** Update File: C:\\secret\\source.ts\n-old\n+new",
        patchBytes: 42,
      },
      output: "partial",
      error: "failed",
    }));

    expect(result.resultText).toBe("partial\nfailed");
    expect(result.executionContent).toContain("[补丁正文已隐藏]");
    expect(result.executionContent).not.toContain("C:\\secret");
  });

  test("renders separate copy actions and omits result copy for empty output", () => {
    const withResultItem = toolItem({ output: "pass", error: "warning" });
    const withResult = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard
          item={withResultItem}
          view={buildToolItemDisplay(withResultItem)}
        />
      </TooltipProvider>,
    );
    const withoutResultItem = toolItem({ output: null, error: null });
    const withoutResult = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard
          item={withoutResultItem}
          view={buildToolItemDisplay(withoutResultItem)}
        />
      </TooltipProvider>,
    );

    expect(withResult).toContain('aria-label="复制执行内容"');
    expect(withResult).toContain('aria-label="复制返回结果"');
    expect(withResult).toContain("pass\nwarning");
    expect(withoutResult).toContain('aria-label="复制执行内容"');
    expect(withoutResult).not.toContain('aria-label="复制返回结果"');
    expect(withoutResult).toContain("无输出");
  });

  test("uses the persisted disclosure state for command details", () => {
    const item = toolItem();
    const collapsed = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: "tool:turn-1:tool-1",
            expanded: false,
            onExpandedChange: () => undefined,
          }}
          item={item}
        />
      </TooltipProvider>,
    );
    const expanded = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: "tool:turn-1:tool-1",
            expanded: true,
            onExpandedChange: () => undefined,
          }}
          item={item}
        />
      </TooltipProvider>,
    );

    expect(collapsed).toContain("已运行 bun test");
    expect(collapsed).not.toContain('aria-label="执行内容"');
    expect(collapsed).toContain("lucide-chevron-right");
    expect(collapsed).not.toContain("lucide-chevron-down");
    expect(expanded).toContain("命令运行了 1 秒");
    expect(expanded).toContain('aria-label="执行内容"');
    expect(expanded).toContain("lucide-chevron-down");
    expect(expanded).not.toContain("lucide-chevron-right");
  });
});
