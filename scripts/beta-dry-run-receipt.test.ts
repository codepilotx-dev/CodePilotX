import { describe, expect, it } from "bun:test";
import {
  createBetaDryRunReceipt,
  validateBetaDryRunReceipt,
} from "./beta-dry-run-receipt.ts";

const MAIN_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);
const DIGEST = "c".repeat(64);
const NOW = new Date("2026-08-03T00:00:00.000Z");

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    ...createBetaDryRunReceipt({
      actor: "xiaohai-ouyang",
      runId: 123,
      runAttempt: 1,
      mainSha: MAIN_SHA,
      proofDigest: DIGEST,
      releaseTreeSha: TREE_SHA,
      nextVersion: "0.2.0-beta.4",
      nextTag: "v0.2.0-beta.4",
      completedAt: NOW,
    }),
    ...overrides,
  };
}

function expected(overrides: Record<string, unknown> = {}) {
  return {
    repository: "codepilotx-dev/CodePilotX",
    actor: "xiaohai-ouyang",
    runId: 123,
    runAttempt: 1,
    mainSha: MAIN_SHA,
    proofDigest: DIGEST,
    releaseTreeSha: TREE_SHA,
    nextVersion: "0.2.0-beta.4",
    nextTag: "v0.2.0-beta.4",
    now: NOW,
    ...overrides,
  } as Parameters<typeof validateBetaDryRunReceipt>[1];
}

describe("Beta dry-run 回执", () => {
  it("接受完全匹配的 24 小时内回执", () => {
    expect(validateBetaDryRunReceipt(receipt(), expected()).runId).toBe(123);
  });

  it("拒绝重复使用到不同 live run 的 dry-run ID", () => {
    expect(() => validateBetaDryRunReceipt(receipt(), expected({ runId: 124 })))
      .toThrow("run ID 不匹配");
  });

  it("拒绝错误 SHA、tree、tag 或 proof digest", () => {
    for (const [field, value] of [
      ["mainSha", "d".repeat(40)],
      ["releaseTreeSha", "d".repeat(40)],
      ["nextTag", "v0.2.0-beta.5"],
      ["proofDigest", "d".repeat(64)],
    ] as const) {
      expect(() => validateBetaDryRunReceipt(receipt({ [field]: value }), expected()))
        .toThrow();
    }
  });

  it("拒绝过期或来自未来的回执", () => {
    const old = new Date(NOW.getTime() - 24 * 60 * 60 * 1_000 - 5 * 60 * 1_000 - 1);
    const future = new Date(NOW.getTime() + 5 * 60 * 1_000 + 1);
    expect(() => validateBetaDryRunReceipt(receipt({ completedAt: old.toISOString() }), expected()))
      .toThrow("已过期");
    expect(() => validateBetaDryRunReceipt(receipt({ completedAt: future.toISOString() }), expected()))
      .toThrow("来自未来");
  });

  it("接受范围合法的可选 timings 且不参与信任判定", () => {
    const withTimings = receipt({
      timings: {
        schemaVersion: 1,
        conptyMs: 25_000,
        agentReadyMs: 12_000,
        desktopReadyMs: 40_000,
        signedPackageMs: 1_200_000,
        installedSmokeMs: 300_000,
        totalMs: 1_800_000,
      },
    });
    expect(validateBetaDryRunReceipt(withTimings, expected()).timings?.totalMs)
      .toBe(1_800_000);
  });

  it("拒绝超范围或结构错误的 timings", () => {
    expect(() => validateBetaDryRunReceipt(
      receipt({ timings: { schemaVersion: 1, totalMs: -1 } }),
      expected(),
    )).toThrow("totalMs");
    expect(() => validateBetaDryRunReceipt(
      receipt({ timings: { schemaVersion: 1, totalMs: 1, conptyMs: 999_999 } }),
      expected(),
    )).toThrow("conptyMs");
    expect(() => validateBetaDryRunReceipt(
      receipt({ timings: { schemaVersion: 2, totalMs: 1 } }),
      expected(),
    )).toThrow("schemaVersion");
  });

  it("create 时校验并规范化 timings", () => {
    expect(createBetaDryRunReceipt({
      actor: "xiaohai-ouyang",
      runId: 123,
      runAttempt: 1,
      mainSha: MAIN_SHA,
      proofDigest: DIGEST,
      releaseTreeSha: TREE_SHA,
      nextVersion: "0.2.0-beta.4",
      nextTag: "v0.2.0-beta.4",
      completedAt: NOW,
      timings: { schemaVersion: 1, conptyMs: 20_000, totalMs: 90_000 },
    }).timings).toEqual({ schemaVersion: 1, conptyMs: 20_000, totalMs: 90_000 });
  });
});
