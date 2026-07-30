import { describe, expect, test } from "bun:test";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanonicalThreadState, RenderTurnEntry } from "@codepilotx/session-view";
import type { Item } from "@codepilotx/shared/thread";

import {
  CanonicalConversationTurn,
  CanonicalProcessGroup,
  findActiveCommandSegmentIndex,
  segmentProcessItems,
} from "../src/features/session/timeline/CanonicalThreadView.js";
import { QuickChatContext } from "../src/features/session/QuickChatContext.js";
import { ConversationItemContext } from "../src/features/session/timeline/ConversationItemContext.js";
import { TooltipProvider } from "../src/components/ui/Tooltip.js";
import {
  isCurrentCanonicalThreadRequest,
  selectVisibleCanonicalState,
} from "../src/features/session/timeline/useCanonicalThreadConversation.js";

function CanonicalTestProviders({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <QuickChatContext.Provider
      value={{} as React.ContextType<typeof QuickChatContext>}
    >
      <ConversationItemContext.Provider
        value={{
          canCopyFileReferenceContents: () => false,
          onCopyFileReferenceContents: () => undefined,
          onOpenFileReference: () => undefined,
          onSubmitEditedUserMessage: async () => undefined,
          sessionStatus: "idle",
          workspacePath: null,
        }}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </ConversationItemContext.Provider>
    </QuickChatContext.Provider>
  );
}

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
    expect(completed).not.toContain("lucide-check");
    expect(completed).toContain("lucide-square-terminal");
    expect(completed).toContain("lucide-chevron-right");
    expect(completed).not.toContain("lucide-chevron-down");
    expect(active).toContain("active-tool-card");
    expect(active).toContain("lucide-loader-circle");
    expect(active).toContain("lucide-chevron-down");
    expect(active).not.toContain("lucide-chevron-right");
    expect(failed).not.toContain("failed-tool-card");
    expect(failed).toContain("lucide-circle-alert");
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

  test("separates file mutations and lifecycle tools from ordinary command groups", () => {
    const tool = (
      id: string,
      name: string,
      input: unknown = null,
    ): Extract<Item, { type: "tool" }> => ({
      id,
      messageID: `message-${id}`,
      turnId: "turn-1",
      agentId: "agent-1",
      type: "tool",
      callID: `call-${id}`,
      tool: name,
      title: name,
      state: "completed",
      input,
      command: name === "Bash" ? "bun test" : null,
      output: null,
      error: null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    });
    const segments = segmentProcessItems([
      tool("tool-1", "Bash"),
      tool("tool-2", "workspace.apply_patch", {
        affectedPaths: [{ path: "src/main.ts", operation: "update" }],
      }),
      tool("tool-3", "update_plan"),
      tool("tool-4", "Read", { file_path: "src/main.ts" }),
      tool("tool-5", "request_permissions"),
      tool("tool-6", "Grep", { pattern: "fallbackTitle" }),
      tool("tool-7", "spawn_agents"),
    ]);

    expect(segments.map((segment) => (
      segment.kind === "commands"
        ? ["commands", ...segment.items.map((command) => command.id)]
        : [segment.kind, segment.item.id]
    ))).toEqual([
      ["commands", "tool-1"],
      ["file-mutation", "tool-2"],
      ["lifecycle-tool", "tool-3"],
      ["commands", "tool-4"],
      ["lifecycle-tool", "tool-5"],
      ["commands", "tool-6"],
      ["lifecycle-tool", "tool-7"],
    ]);

    const mutationRunning = {
      ...tool("tool-8", "workspace.apply_patch", {
        affectedPaths: [{ path: "src/main.ts", operation: "update" }],
      }),
      state: "running" as const,
      finishedAt: null,
      durationMs: null,
    };
    const commandBeforeMutation = segmentProcessItems([
      tool("tool-1", "Bash"),
      mutationRunning,
    ]);
    expect(findActiveCommandSegmentIndex(commandBeforeMutation, true)).toBe(-1);
  });

  test("renders process before the final answer and keeps file changes after it", () => {
    const processText = {
      id: "process-text-1",
      messageID: "message-process",
      turnId: "turn-1",
      agentId: "agent-1",
      type: "text",
      // Historical projection can classify an old result-placement item as process content.
      placement: "result",
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
    const planTool = {
      ...tool,
      id: "tool-plan",
      messageID: "message-plan-tool",
      callID: "call-plan",
      tool: "update_plan",
      title: "update_plan",
      input: {
        plan: [{ step: "检查实现", status: "completed" }],
      },
      command: null,
      output: JSON.stringify({ status: "updated" }),
      createdAt: 750,
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
      items: [processText, planTool, tool, answer, patch],
      userItems: [],
      attachments: [],
      processItems: [processText, planTool, tool],
      assistantResultItems: [answer],
      patchItems: [patch],
      postAssistantItems: [],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [],
    } as unknown as RenderTurnEntry;
    const markup = renderToStaticMarkup(
      <CanonicalTestProviders>
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
      </CanonicalTestProviders>,
    );
    const collapsedMarkup = renderToStaticMarkup(
      <CanonicalTestProviders>
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
      </CanonicalTestProviders>,
    );
    const activeMarkup = renderToStaticMarkup(
      <CanonicalTestProviders>
          <CanonicalConversationTurn
            disclosureState={{
              expandedIds: new Set(),
              onExpandedChange: () => undefined,
            }}
            entry={{
              ...entry,
              turn: { ...entry.turn, status: "running" },
            }}
            onOpenPlanInRightDock={() => undefined}
            onOpenSubagent={() => undefined}
            rightDockPlanEventId={null}
          />
      </CanonicalTestProviders>,
    );

    const processIndex = markup.indexOf("已处理 5m 59s");
    const processTextIndex = markup.indexOf("中间处理说明标记");
    const lifecycleIndex = markup.indexOf("已更新计划");
    const commandsIndex = markup.indexOf("运行了 1 条命令");
    const answerIndex = markup.indexOf("最终回复标记");
    const patchIndex = markup.indexOf("已编辑 1 个文件");
    expect(processIndex).toBeGreaterThan(-1);
    expect(processTextIndex).toBeGreaterThan(processIndex);
    expect(lifecycleIndex).toBeGreaterThan(processTextIndex);
    expect(commandsIndex).toBeGreaterThan(lifecycleIndex);
    expect(answerIndex).toBeGreaterThan(commandsIndex);
    expect(answerIndex).toBeGreaterThan(processIndex);
    expect(patchIndex).toBeGreaterThan(answerIndex);
    expect(collapsedMarkup).not.toContain("中间处理说明标记");
    expect(collapsedMarkup).not.toContain("bun test");
    expect(collapsedMarkup).toContain("最终回复标记");
    expect(collapsedMarkup).toContain("已编辑 1 个文件");
    expect(activeMarkup).not.toContain("已编辑 1 个文件");
    expect(markup.match(/canonical-message-actions--assistant/g)).toHaveLength(1);
  });
});
