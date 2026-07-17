import { describe, expect, test } from "bun:test";

import {
  deriveThreadSummaryState,
  resolveThreadSummaryDisplayMode,
  THREAD_SUMMARY_SHIFT_PX,
  toggleThreadSummaryPreference,
  transitionThreadSummaryMode,
} from "../src/features/session/threadSummaryState.js";
import {
  deriveThreadSummaryViewModel,
  findLatestThreadSummaryPlan,
  previewThreadSummarySources,
} from "../src/features/session/threadSummaryViewModel.js";

describe("thread summary state", () => {
  test("resolves the exact responsive boundaries", () => {
    expect(resolveThreadSummaryDisplayMode(1095)).toBe("overlay");
    expect(resolveThreadSummaryDisplayMode(1096)).toBe("shift");
    expect(resolveThreadSummaryDisplayMode(1535)).toBe("shift");
    expect(resolveThreadSummaryDisplayMode(1536)).toBe("gutter");
    expect(resolveThreadSummaryDisplayMode(Number.NaN)).toBe("overlay");
  });

  test("derives inline visibility and the Codex half-panel shift", () => {
    expect(
      deriveThreadSummaryState(1096, {
        isPinned: true,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      displayMode: "shift",
      shouldShowInline: true,
      contentShift: THREAD_SUMMARY_SHIFT_PX,
    });
    expect(THREAD_SUMMARY_SHIFT_PX).toBe(-158);

    expect(
      deriveThreadSummaryState(1536, {
        isPinned: true,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      displayMode: "gutter",
      shouldShowInline: true,
      contentShift: 0,
    });
    expect(
      deriveThreadSummaryState(1096, {
        isPinned: false,
        isPopoverOpen: false,
      }),
    ).toMatchObject({
      shouldShowInline: false,
      contentShift: 0,
    });
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
