import { describe, expect, test } from "bun:test";
import type { Item, TurnStatus } from "@codepilotx/shared/thread";
import { summarizeProcessItems } from "../src/features/session/timeline/summarizeProcessItems.js";

function toolItem(overrides: Partial<Record<string, unknown>> & { state: string }): Item {
  return {
    id: "t1",
    messageID: "t1",
    turnId: "turn1",
    agentId: "a1",
    type: "tool",
    callID: "c1",
    tool: "Bash",
    title: "run test",
    input: null,
    command: null,
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: 0,
    ...overrides,
  } as unknown as Item;
}

function reasoningItem(overrides: Partial<Record<string, unknown>> & { status: string }): Item {
  return {
    id: "r1",
    messageID: "r1",
    turnId: "turn1",
    agentId: "a1",
    type: "reasoning",
    text: "thinking...",
    createdAt: 0,
    ...overrides,
  } as unknown as Item;
}

function activityItem(overrides: Partial<Record<string, unknown>> & { status: string }): Item {
  return {
    id: "a1",
    messageID: "a1",
    turnId: "turn1",
    agentId: "a1",
    type: "activity",
    activity: "build",
    title: "Building",
    createdAt: 0,
    ...overrides,
  } as unknown as Item;
}

describe("summarizeProcessItems", () => {
  test("empty items with idle turn returns inactive + empty label", () => {
    const r = summarizeProcessItems([], "completed", 0);
    expect(r.active).toBe(false);
    expect(r.failed).toBe(false);
    expect(r.label).toBe("");
  });

  test("empty items with waiting turn returns active + waiting label", () => {
    const r = summarizeProcessItems([], "waiting-permission", 0);
    expect(r.active).toBe(true);
    expect(r.failed).toBe(false);
    expect(r.label).toBe("等待操作");
  });

  test("empty items with waiting-question returns active", () => {
    const r = summarizeProcessItems([], "waiting-question", 5);
    expect(r.active).toBe(true);
    expect(r.label).toBe("等待操作");
  });

  test("running tool item returns active + thinking label", () => {
    const r = summarizeProcessItems([toolItem({ state: "running" })], "running", 10);
    expect(r.active).toBe(true);
    expect(r.failed).toBe(false);
    expect(r.label).toBe("正在思考");
  });

  test("streaming reasoning item returns active + thinking label", () => {
    const r = summarizeProcessItems([reasoningItem({ status: "streaming" })], "running", 0);
    expect(r.active).toBe(true);
    expect(r.failed).toBe(false);
  });

  test("running activity item returns active", () => {
    const r = summarizeProcessItems([activityItem({ status: "running" })], "running", 3);
    expect(r.active).toBe(true);
  });

  test("failed tool item returns failed", () => {
    const r = summarizeProcessItems([toolItem({ state: "error" })], "completed", 30);
    expect(r.active).toBe(false);
    expect(r.failed).toBe(true);
    expect(r.label).toBe("执行出错");
  });

  test("interrupted tool item returns failed", () => {
    const r = summarizeProcessItems([toolItem({ state: "interrupted" })], "completed", 0);
    expect(r.failed).toBe(true);
  });

  test("all completed items with elapsed seconds returns duration label", () => {
    const r = summarizeProcessItems(
      [toolItem({ state: "completed" }), reasoningItem({ status: "completed" })],
      "completed",
      84,
    );
    expect(r.active).toBe(false);
    expect(r.failed).toBe(false);
    expect(r.label).toBe("执行了 1 分 24 秒");
  });

  test("completed items with zero elapsed returns count label", () => {
    const r = summarizeProcessItems(
      [toolItem({ state: "completed" }), reasoningItem({ status: "completed" })],
      "completed",
      0,
    );
    expect(r.active).toBe(false);
    expect(r.label).toBe("2 项活动");
  });

  test("completed items with small elapsed returns seconds label", () => {
    const r = summarizeProcessItems([reasoningItem({ status: "completed" })], "completed", 42);
    expect(r.label).toBe("执行了 42 秒");
  });

  test("waiting-permission turn keeps group active even if all items completed", () => {
    const r = summarizeProcessItems([toolItem({ state: "completed" })], "waiting-permission", 120);
    expect(r.active).toBe(true);
    expect(r.failed).toBe(false);
    expect(r.label).toBe("等待操作");
  });

  test("failed item overrides running items", () => {
    const r = summarizeProcessItems(
      [toolItem({ state: "running" }), toolItem({ state: "error" })],
      "running",
      10,
    );
    expect(r.active).toBe(false);
    expect(r.failed).toBe(true);
    expect(r.label).toBe("执行出错");
  });
});
