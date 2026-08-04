/**
 * release-timing.ts — 发布流程各阶段耗时的安全指标。
 *
 * 只记录毫秒数、计数、阶段名和成功状态；不记录 origin、token、命令环境、
 * 本地绝对路径、证书信息或日志正文。timing 不参与 proof 信任判定，也不因
 * 超过目标自动失败；超过目标只警告。
 */

export const RELEASE_TIMING_SCHEMA_VERSION = 1 as const;

/** 最近 20 次成功 dry-run 的 P95 目标：12 分钟。超过只警告。 */
export const RELEASE_DRY_RUN_P95_TARGET_MS = 12 * 60_000;

const TIMING_CAPS_MS = {
  conptyMs: 120_000,
  agentReadyMs: 300_000,
  desktopReadyMs: 300_000,
  signedPackageMs: 3_600_000,
  installedSmokeMs: 900_000,
} as const;

const OPTIONAL_TIMING_FIELDS = [
  "conptyMs",
  "agentReadyMs",
  "desktopReadyMs",
  "signedPackageMs",
  "installedSmokeMs",
] as const;

export interface ReleaseTimingMetricsV1 {
  schemaVersion: typeof RELEASE_TIMING_SCHEMA_VERSION;
  conptyMs?: number;
  agentReadyMs?: number;
  desktopReadyMs?: number;
  signedPackageMs?: number;
  installedSmokeMs?: number;
  totalMs: number;
}

export interface ReleaseTimingInput {
  conptyMs?: number;
  agentReadyMs?: number;
  desktopReadyMs?: number;
  signedPackageMs?: number;
  installedSmokeMs?: number;
  totalMs: number;
}

export function createReleaseTimingMetrics(
  input: ReleaseTimingInput,
): ReleaseTimingMetricsV1 {
  const metrics = {
    schemaVersion: RELEASE_TIMING_SCHEMA_VERSION,
    totalMs: input.totalMs,
  } satisfies ReleaseTimingMetricsV1;
  for (const field of OPTIONAL_TIMING_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    (metrics as Record<string, unknown>)[field] = value;
  }
  return validateReleaseTimingMetrics(metrics);
}

function isNonNegativeFiniteInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validateReleaseTimingMetrics(
  value: unknown,
): ReleaseTimingMetricsV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Release timing 指标结构无效");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== RELEASE_TIMING_SCHEMA_VERSION) {
    throw new Error("Release timing 指标 schemaVersion 无效");
  }
  if (!isNonNegativeFiniteInteger(record.totalMs)) {
    throw new Error("Release timing 指标 totalMs 无效");
  }
  for (const field of OPTIONAL_TIMING_FIELDS) {
    if (record[field] === undefined) continue;
    const cap = TIMING_CAPS_MS[field];
    if (!isNonNegativeFiniteInteger(record[field]) || (record[field] as number) > cap) {
      throw new Error(`Release timing 指标 ${field} 超出范围`);
    }
  }
  return record as unknown as ReleaseTimingMetricsV1;
}

export function parseReleaseTimingMetrics(
  payload: string,
): ReleaseTimingMetricsV1 {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Release timing 指标不是有效 JSON");
  }
  return validateReleaseTimingMetrics(value);
}

/** 超过 12 分钟目标时只警告，不降低门禁、不放宽 timeout、不判失败。 */
export function warnIfDryRunOverTarget(totalMs: number): void {
  if (totalMs > RELEASE_DRY_RUN_P95_TARGET_MS) {
    console.warn(
      `  ⚠ dry-run 总耗时 ${Math.round(totalMs / 1_000)}s 超过 P95 目标 `
      + `${RELEASE_DRY_RUN_P95_TARGET_MS / 60_000} 分钟（仅警告，不影响结果）`,
    );
  }
}
