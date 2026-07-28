import { describe, expect, test } from "bun:test";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanonicalThreadState, RenderTurnEntry } from "@codepilotx/session-view";
import type { Item } from "@codepilotx/shared/thread";

import {
  CanonicalConversationTurn,
  CanonicalProcessGroup,
  segmentProcessItems,
} from "../src/features/session/timeline/CanonicalThreadView.js";
import { QuickChatContext } from "../src/features/session/QuickChatContext.js";
import { TooltipProvider } from "../src/components/ui/Tooltip.js";
import {
  isCurrentCanonicalThreadRequest,
  selectVisibleCanonicalState,
} from "../src/features/session/timeline/useCanonicalThreadConversation.js";

describe("canonical thread switch", () => {
  const disclosureProps = {
    disclosureId: "command-group:turn-1:tool-1",
    expanded: false,
    onExpandedChange: () => undefined,
    variant: "commands" as const,
  };

  test("does not expose state from the previous thread", () => {
    const state = {
      thread: { id: "thread-a" },
    } as unknown as CanonicalThreadState;

    expect(selectVisibleCanonicalState(state, "thread-a")).toBe(state);
    expect(selectVisibleCanonicalState(state, "thread-b")).toBeNull();
    expect(selectVisibleCanonicalState(state, null)).toBeNull();
  });

  test("rejects history and live results from an older thread generation", () => {
    expect(isCurrentCanonicalThreadRequest("thread-b", 2, "thread-b", 2)).toBe(true);
    expect(isCurrentCanonicalThreadRequest("thread-b", 2, "thread-a", 1)).toBe(false);
    expect(isCurrentCanonicalThreadRequest("thread-a", 2, "thread-a", 1)).toBe(false);
  });

  test("does not mount completed process children before expansion", () => {
    const completed = renderToStaticMarkup(
      <CanonicalProcessGroup
        {...disclosureProps}
        active={false}
        failed={false}
        label="运行了 1 条命令"
      >
        <span data-testid="expensive-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    );
    const active = renderToStaticMarkup(
      <CanonicalProcessGroup
        {...disclosureProps}
        active
        failed={false}
        label="正在运行 bun test"
      >
        <span data-testid="active-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    );
    const failed = renderToStaticMarkup(
      <CanonicalProcessGroup
        {...disclosureProps}
        active={false}
        failed
        label="运行了 1 条命令"
      >
        <span data-testid="failed-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    );
    const persisted = renderToStaticMarkup(
      <CanonicalProcessGroup
        {...disclosureProps}
        active={false}
        expanded
        failed={false}
        label="运行了 1 条命令"
      >
        <span data-testid="persisted-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    );

    expect(completed).not.toContain("expensive-tool-card");
    expect(completed).toContain("lucide-chevron-right");
    expect(completed).not.toContain("lucide-chevron-down");
    expect(active).toContain("active-tool-card");
    expect(active).toContain("lucide-chevron-down");
    expect(active).not.toContain("lucide-chevron-right");
    expect(failed).not.toContain("failed-tool-card");
    expect(persisted).toContain("persisted-tool-card");
    expect(persisted).toContain("lucide-chevron-down");
  });

  test("keeps non-tool process items ordered around consecutive command groups", () => {
    const item = (id: string, type: Item["type"]): Item => ({
      id,
      type,
    } as unknown as Item);
    const segments = segmentProcessItems([
      item("reasoning-1", "reasoning"),
      item("tool-1", "tool"),
      item("tool-2", "tool"),
      item("activity-1", "activity"),
      item("tool-3", "tool"),
      item("subagent-1", "subagent"),
    ]);

    expect(segments.map((segment) => (
      segment.kind === "commands"
        ? ["commands", ...segment.items.map((command) => command.id)]
        : ["item", segment.item.id]
    ))).toEqual([
      ["item", "reasoning-1"],
      ["commands", "tool-1", "tool-2"],
      ["item", "activity-1"],
      ["commands", "tool-3"],
      ["item", "subagent-1"],
    ]);
  });

  test("renders process before the final answer and keeps file changes after it", () => {
    const processText = {
      id: "process-text-1",
      messageID: "message-process",
      turnId: "turn-1",
      agentId: "agent-1",
      type: "text",
      placement: "process",
      text: "中间处理说明标记",
      status: "completed",
      createdAt: 500,
    } as const;
    const tool = {
      id: "tool-1",
      messageID: "message-tool",
      turnId: "turn-1",
      agentId: "agent-1",
      type: "tool",
      callID: "call-1",
      tool: "Bash",
      title: "运行测试",
      state: "completed",
      input: null,
      command: "bun test",
      output: "pass",
      error: null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    } as const;
    const answer = {
      id: "answer-1",
      messageID: "message-answer",
      turnId: "turn-1",
      agentId: "agent-1",
      type: "text",
      placement: "result",
      text: "最终回复标记",
      status: "completed",
      createdAt: 2_000,
    } as const;
    const patch = {
      id: "patch-1",
      messageID: "message-patch",
      turnId: "turn-1",
      agentId: "agent-1",
      type: "patch",
      files: [{
        path: "src/main.ts",
        additions: 1,
        deletions: 0,
        patch: null,
      }],
      totalAdditions: 1,
      totalDeletions: 0,
      createdAt: 3_000,
    } as const;
    const entry = {
      id: "turn-1",
      turn: {
        id: "turn-1",
        status: "completed",
        elapsedSeconds: 359,
        error: null,
      },
      items: [processText, tool, answer, patch],
      userItems: [],
      attachments: [],
      processItems: [processText, tool],
      assistantResultItems: [answer],
      patchItems: [patch],
      postAssistantItems: [],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [],
    } as unknown as RenderTurnEntry;
    const markup = renderToStaticMarkup(
      <QuickChatContext.Provider
        value={{} as React.ContextType<typeof QuickChatContext>}
      >
        <TooltipProvider>
          <CanonicalConversationTurn
            disclosureState={{
              expandedIds: new Set(["turn-process:turn-1"]),
              onExpandedChange: () => undefined,
            }}
            entry={entry}
            onOpenPlanInRightDock={() => undefined}
            onOpenSubagent={() => undefined}
            rightDockPlanEventId={null}
          />
        </TooltipProvider>
      </QuickChatContext.Provider>,
    );
    const collapsedMarkup = renderToStaticMarkup(
      <QuickChatContext.Provider
        value={{} as React.ContextType<typeof QuickChatContext>}
      >
        <TooltipProvider>
          <CanonicalConversationTurn
            disclosureState={{
              expandedIds: new Set(),
              onExpandedChange: () => undefined,
            }}
            entry={entry}
            onOpenPlanInRightDock={() => undefined}
            onOpenSubagent={() => undefined}
            rightDockPlanEventId={null}
          />
        </TooltipProvider>
      </QuickChatContext.Provider>,
    );

    const processIndex = markup.indexOf("已处理 5m 59s");
    const processTextIndex = markup.indexOf("中间处理说明标记");
    const answerIndex = markup.indexOf("最终回复标记");
    const patchIndex = markup.indexOf("1 个文件已更改");
    expect(processIndex).toBeGreaterThan(-1);
    expect(processTextIndex).toBeGreaterThan(processIndex);
    expect(answerIndex).toBeGreaterThan(processTextIndex);
    expect(answerIndex).toBeGreaterThan(processIndex);
    expect(patchIndex).toBeGreaterThan(answerIndex);
    expect(collapsedMarkup).not.toContain("中间处理说明标记");
    expect(collapsedMarkup).not.toContain("bun test");
    expect(collapsedMarkup).toContain("最终回复标记");
    expect(collapsedMarkup).toContain("1 个文件已更改");
  });
});
