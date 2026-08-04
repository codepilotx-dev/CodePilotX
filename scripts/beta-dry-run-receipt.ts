import {
  validateReleaseTimingMetrics,
  type ReleaseTimingMetricsV1,
} from "./release-timing.ts";

export const BETA_DRY_RUN_RECEIPT_VALIDITY_MS = 24 * 60 * 60 * 1_000;
export const BETA_DRY_RUN_RECEIPT_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export interface BetaDryRunReceiptV1 {
  schemaVersion: 1;
  repository: "codepilotx-dev/CodePilotX";
  workflow: "prepare-beta-release.yml";
  event: "workflow_dispatch";
  actor: string;
  runId: number;
  runAttempt: number;
  mainSha: string;
  proofDigest: string;
  releaseTreeSha: string;
  nextVersion: string;
  nextTag: string;
  completedAt: string;
  result: "passed";
  /** 安全耗时指标；只做范围校验，不参与信任判定。 */
  timings?: ReleaseTimingMetricsV1;
}

export interface BetaDryRunReceiptExpectation {
  repository: string;
  actor: string;
  runId: number;
  runAttempt: number;
  mainSha: string;
  proofDigest: string;
  releaseTreeSha: string;
  nextVersion: string;
  nextTag: string;
  now?: Date;
}

export function createBetaDryRunReceipt(
  input: Omit<BetaDryRunReceiptV1,
    "schemaVersion" | "repository" | "workflow" | "event" |
    "completedAt" | "result"> & { completedAt?: Date },
): BetaDryRunReceiptV1 {
  const receipt: BetaDryRunReceiptV1 = {
    schemaVersion: 1,
    repository: "codepilotx-dev/CodePilotX",
    workflow: "prepare-beta-release.yml",
    event: "workflow_dispatch",
    actor: input.actor,
    runId: input.runId,
    runAttempt: input.runAttempt,
    mainSha: input.mainSha,
    proofDigest: input.proofDigest,
    releaseTreeSha: input.releaseTreeSha,
    nextVersion: input.nextVersion,
    nextTag: input.nextTag,
    completedAt: (input.completedAt ?? new Date()).toISOString(),
    result: "passed",
  };
  if (input.timings !== undefined) {
    receipt.timings = validateReleaseTimingMetrics(input.timings);
  }
  return receipt;
}

export function validateBetaDryRunReceipt(
  value: unknown,
  expected: BetaDryRunReceiptExpectation,
): BetaDryRunReceiptV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Beta dry-run 回执结构无效");
  }
  const receipt = value as Partial<BetaDryRunReceiptV1>;
  if (receipt.schemaVersion !== 1 ||
      receipt.repository !== "codepilotx-dev/CodePilotX" ||
      receipt.workflow !== "prepare-beta-release.yml" ||
      receipt.event !== "workflow_dispatch" ||
      receipt.result !== "passed") {
    throw new Error("Beta dry-run 回执身份无效");
  }
  if (!Number.isSafeInteger(receipt.runId) || (receipt.runId ?? 0) <= 0 ||
      !Number.isSafeInteger(receipt.runAttempt) || (receipt.runAttempt ?? 0) <= 0) {
    throw new Error("Beta dry-run 回执 run 元数据无效");
  }
  if (typeof receipt.mainSha !== "string" || !SHA_RE.test(receipt.mainSha) ||
      typeof receipt.releaseTreeSha !== "string" || !SHA_RE.test(receipt.releaseTreeSha) ||
      typeof receipt.proofDigest !== "string" || !DIGEST_RE.test(receipt.proofDigest)) {
    throw new Error("Beta dry-run 回执 SHA 或证明摘要无效");
  }
  if (typeof receipt.nextVersion !== "string" ||
      receipt.nextTag !== `v${receipt.nextVersion}` ||
      typeof receipt.actor !== "string" || receipt.actor.length === 0) {
    throw new Error("Beta dry-run 回执版本或 actor 无效");
  }
  const completedAt = Date.parse(receipt.completedAt ?? "");
  if (!Number.isFinite(completedAt) ||
      new Date(completedAt).toISOString() !== receipt.completedAt) {
    throw new Error("Beta dry-run 回执完成时间无效");
  }
  const now = (expected.now ?? new Date()).getTime();
  if (completedAt > now + BETA_DRY_RUN_RECEIPT_CLOCK_SKEW_MS) {
    throw new Error("Beta dry-run 回执来自未来");
  }
  if (completedAt < now - BETA_DRY_RUN_RECEIPT_VALIDITY_MS - BETA_DRY_RUN_RECEIPT_CLOCK_SKEW_MS) {
    throw new Error("Beta dry-run 回执已过期");
  }
  const comparisons: Array<[unknown, unknown, string]> = [
    [receipt.repository, expected.repository, "repository"],
    [receipt.actor, expected.actor, "actor"],
    [receipt.runId, expected.runId, "run ID"],
    [receipt.runAttempt, expected.runAttempt, "run attempt"],
    [receipt.mainSha, expected.mainSha, "main SHA"],
    [receipt.proofDigest, expected.proofDigest, "proof digest"],
    [receipt.releaseTreeSha, expected.releaseTreeSha, "release tree"],
    [receipt.nextVersion, expected.nextVersion, "version"],
    [receipt.nextTag, expected.nextTag, "tag"],
  ];
  for (const [actual, wanted, label] of comparisons) {
    if (actual !== wanted) throw new Error(`Beta dry-run 回执 ${label} 不匹配`);
  }
  if (receipt.timings !== undefined) {
    validateReleaseTimingMetrics(receipt.timings);
  }
  return receipt as BetaDryRunReceiptV1;
}
