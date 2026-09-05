import { describe, expect, test } from "bun:test";

import {
  THREAD_SUMMARY_PANEL_WIDTH,
  deriveThreadSummaryState,
  resolveThreadSummaryDisplayMode,
  resolveThreadSummaryDisplayModeUpdate,
  toggleThreadSummaryPreference,
  transitionThreadSummaryMode,
} from "../src/features/session/summary/threadSummaryState.js";
import {
  deriveThreadSummaryViewModel,
  findLatestThreadSummaryPlan,
  previewThreadSummarySources,
} from "../src/features/session/summary/threadSummaryViewModel.js";

describe("thread summary state", () => {
  test("resolves the exact responsive boundaries", () => {
    expect(THREAD_SUMMARY_PANEL_WIDTH).toBe(260);
    expect(resolveThreadSummaryDisplayMode(959)).toBe("overlay");
    expect(resolveThreadSummaryDisplayMode(960)).toBe("shift");
    expect(resolveThreadSummaryDisplayMode(1535)).toBe("shift");
    expect(resolveThreadSummaryDisplayMode(1536)).toBe("gutter");
    expect(resolveThreadSummaryDisplayMode(Number.NaN)).toBe("overlay");
  });

  test("reserves inline space only for a pinned summary outside overlay mode", () => {
    const inlineState = deriveThreadSummaryState(960, {
      isPinned: true,
      isPopoverOpen: false,
    });
    expect(inlineState).toMatchObject({
      displayMode: "shift",
      shouldShowInline: true,
    });
    expect(inlineState).not.toHaveProperty("contentShift");

    expect(
      deriveThreadSummaryState(1536, {
        isPinned: true,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      displayMode: "gutter",
      shouldShowInline: true,
    });
    expect(
      deriveThreadSummaryState(960, {
        isPinned: false,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      shouldShowInline: false,
    });
    expect(
      deriveThreadSummaryState(959, {
        isPinned: true,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      displayMode: "overlay",
      shouldShowInline: false,
    });
  });

  test("updates React state only when a resize crosses a display mode boundary", () => {
    let mode = resolveThreadSummaryDisplayMode(700);
    let updates = 0;
    for (let width = 701; width <= 1700; width += 1) {
      const nextMode = resolveThreadSummaryDisplayModeUpdate(mode, width);
      if (nextMode === null) continue;
      mode = nextMode;
      updates += 1;
    }
    expect(updates).toBe(2);
    expect(mode).toBe("gutter");
  });

  test("toggles popover on narrow content and pinning on wide content", () => {
    const initial = { isPinned: true, isPopoverOpen: false };
    expect(toggleThreadSummaryPreference(initial, "overlay")).toEqual({
      isPinned: true,
      isPopoverOpen: true,
    });
    expect(toggleThreadSummaryPreference(initial, "shift")).toEqual({
      isPinned: false,
      isPopoverOpen: false,
    });
  });

  test("closes the popover when leaving overlay without resetting pinning", () => {
    const open = { isPinned: true, isPopoverOpen: true };
    expect(transitionThreadSummaryMode(open, "overlay", "shift")).toEqual({
      isPinned: true,
      isPopoverOpen: false,
    });
    expect(transitionThreadSummaryMode(open, "overlay", "overlay")).toBe(open);
  });
});

describe("thread summary view model", () => {
  test("derives all five real-data sections and selects the latest valid plan", () => {
    const events = [
      {
        id: "plan-1",
        type: "proposed_plan",
        content: "# 旧计划",
      },
      {
        id: "empty-plan",
        type: "proposed_plan",
        content: "   ",
      },
      {
        id: "plan-2",
        type: "proposed_plan",
        content: "# 新计划\n\n内容",
      },
    ];
    const model = deriveThreadSummaryViewModel({
      additions: 12,
      branchName: " feature/summary ",
      changedFileCount: 3,
      deletions: 4,
      events,
      sources: [{ label: "OpenAI", url: "https://openai.com/" }],
      subagents: [
        {
          task: { id: "task-1", displayName: "资料梳理" },
          currentRun: { status: "running" },
        },
      ] as never,
      workspacePath: "F:\\CodeProject\\CodePilotX-Ts",
    });

    expect(model.environment).toEqual({
      workspacePath: "F:\\CodeProject\\CodePilotX-Ts",
      branchName: "feature/summary",
      changedFileCount: 3,
      commitOrPushEnabled: true,
      commitOrPushDisabledReason: null,
      createPullRequestEnabled: true,
      createPullRequestDisabledReason: null,
    });
    expect(model.changes).toEqual({
      fileCount: 3,
      additions: 12,
      deletions: 4,
    });
    expect(model.plan).toEqual({
      eventId: "plan-2",
      title: "新计划",
      content: "# 新计划\n\n内容",
    });
    expect(model.sources).toHaveLength(1);
    expect(model.subagents).toEqual([
      { id: "task-1", name: "资料梳理", status: "running" },
    ]);
  });

  test("hides empty sections and ignores malformed plans", () => {
    const model = deriveThreadSummaryViewModel({
      additions: 0,
      branchName: null,
      changedFileCount: 0,
      deletions: 0,
      events: [{ type: "proposed_plan", content: 42 }],
      sources: [],
      subagents: [],
      workspacePath: null,
    });

    expect(model).toEqual({
      environment: null,
      changes: null,
      plan: null,
      sources: [],
      subagents: [],
    });
    expect(findLatestThreadSummaryPlan([])).toBeNull();
  });

  test("keeps the changes entry for a workspace with no changes and explains disabled Git actions", () => {
    const model = deriveThreadSummaryViewModel({
      additions: 0,
      branchName: "  ",
      changedFileCount: 0,
      deletions: 0,
      events: [],
      sources: [],
      subagents: [],
      workspacePath: "F:\\CodeProject\\CodePilotX-Ts",
    });

    expect(model.environment).toMatchObject({
      branchName: null,
      changedFileCount: 0,
      commitOrPushEnabled: true,
      commitOrPushDisabledReason: null,
      createPullRequestEnabled: false,
      createPullRequestDisabledReason:
        "创建拉取请求前需要先创建或检出 Git 分支",
    });
    expect(model.changes).toEqual({
      fileCount: 0,
      additions: 0,
      deletions: 0,
    });
  });

  test("previews the first three sources for the summary side panel", () => {
    const sources = Array.from({ length: 7 }, (_, index) => ({
      label: `来源 ${index + 1}`,
      url: `https://example.com/${index + 1}`,
    }));

    expect(previewThreadSummarySources(sources)).toEqual({
      items: sources.slice(0, 3),
      totalCount: 7,
    });
  });
});
