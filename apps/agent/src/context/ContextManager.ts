import type { AgentDatabase } from "../storage/database/AgentDatabase";

export type AgentInputItem = Record<string, any>;

export type ContextFragmentKind =
  | "mode"
  | "permission"
  | "settings"
  | "project"
  | "skill"
  | "memory"
  | "subagent"
  | "plan";

export type ContextFragment = {
  id: string;
  kind: ContextFragmentKind;
  version: number;
  hash: string;
  payload: unknown;
  createdAt: number;
};

export type PromptSessionState = {
  threadID: string;
  baselineVersion: number;
  promptVersion: string;
  baseHash: string;
  contextHash: string;
  cacheKey: string;
  fragments: ContextFragment[];
  contextWindowTokens: number;
  usageTokens: number;
  usageSource: ContextUsageSource;
  usageSampleID: string | null;
  needsCompaction: boolean;
  createdAt: number;
  updatedAt: number;
};

export type EstablishBaselineInput = Pick<
  PromptSessionState,
  "threadID" | "promptVersion" | "baseHash" | "contextHash" | "cacheKey"
> & { fragments?: ContextFragment[] };

export type ContextUsageSource =
  | "measured"
  | "estimated"
  | "compaction-estimate";

export type ContextUsageSample = {
  id: string;
  threadID: string;
  turnID: string | null;
  sessionID: string | null;
  contextFingerprint: string;
  contextWindowTokens: number;
  inputTokens: number;
  outputTokens: number;
  source: ContextUsageSource;
  createdAt: number;
};

export type ContextBudgetSnapshot = {
  threadID: string;
  contextFingerprint: string;
  contextWindowTokens: number;
  usedTokens: number;
  remainingTokens: number;
  utilization: number;
  triggerTokens: number;
  targetTokens: number;
  needsCompaction: boolean;
  source: ContextUsageSource;
  sampleID: string;
  sampledAt: number;
};

const parse = <T>(value: string) => JSON.parse(value) as T;
export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.8;
export const CONTEXT_COMPACTION_TARGET_RATIO = 0.55;
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  return value;
};

const stableStringify = (value: unknown) => JSON.stringify(canonicalize(value));
const fingerprint = (value: unknown) =>
  new Bun.CryptoHasher("sha256").update(stableStringify(value)).digest("hex");

export const estimateContextTokens = (input: {
  items: AgentInputItem[];
  promptText?: string;
}) => {
  const bytes = new TextEncoder().encode(
    stableStringify({ items: input.items, promptText: input.promptText ?? "" }),
  ).byteLength;
  return Math.max(1, Math.ceil(bytes / 4) + input.items.length * 4);
};

export const contextFingerprint = (input: {
  items: AgentInputItem[];
  promptText?: string;
}) => fingerprint({ items: input.items, promptText: input.promptText ?? "" });

const thresholds = (contextWindowTokens: number) => ({
  triggerTokens: Math.ceil(
    contextWindowTokens * CONTEXT_COMPACTION_TRIGGER_RATIO,
  ),
  targetTokens: Math.floor(
    contextWindowTokens * CONTEXT_COMPACTION_TARGET_RATIO,
  ),
});

export class ContextManager {
  constructor(private readonly db: AgentDatabase) {}

  state(threadID: string): PromptSessionState | null {
    const row = this.db.sqlite
      .query(
        "SELECT thread_id, baseline_version, prompt_version, base_hash, context_hash, cache_key, fragments, context_window_tokens, usage_tokens, usage_source, usage_sample_id, needs_compaction, created_at, updated_at FROM prompt_session_state WHERE thread_id = ?",
      )
      .get(threadID) as Record<string, string | number | null> | null;
    return row
      ? {
          threadID: String(row.thread_id),
          baselineVersion: Number(row.baseline_version),
          promptVersion: String(row.prompt_version),
          baseHash: String(row.base_hash),
          contextHash: String(row.context_hash),
          cacheKey: String(row.cache_key),
          fragments: parse<ContextFragment[]>(String(row.fragments)),
          contextWindowTokens: Number(row.context_window_tokens),
          usageTokens: Number(row.usage_tokens),
          usageSource: String(row.usage_source) as ContextUsageSource,
          usageSampleID:
            row.usage_sample_id == null ? null : String(row.usage_sample_id),
          needsCompaction: Boolean(row.needs_compaction),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }
      : null;
  }

  establishBaseline(input: EstablishBaselineInput) {
    const timestamp = Date.now();
    return this.db.transaction(() => {
      const previous = this.state(input.threadID);
      const baselineVersion = (previous?.baselineVersion ?? 0) + 1;
      this.db.sqlite
        .query(
          `INSERT INTO prompt_session_state (thread_id, baseline_version, prompt_version, base_hash, context_hash, cache_key, fragments, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET baseline_version = excluded.baseline_version, prompt_version = excluded.prompt_version, base_hash = excluded.base_hash, context_hash = excluded.context_hash, cache_key = excluded.cache_key, fragments = excluded.fragments, usage_tokens = 0, usage_source = 'estimated', usage_sample_id = NULL, needs_compaction = 0, updated_at = excluded.updated_at`,
        )
        .run(
          input.threadID,
          baselineVersion,
          input.promptVersion,
          input.baseHash,
          input.contextHash,
          input.cacheKey,
          JSON.stringify(input.fragments ?? []),
          previous?.createdAt ?? timestamp,
          timestamp,
        );
      return this.state(input.threadID)!;
    });
  }

  appendFragments(
    threadID: string,
    fragments: ContextFragment[],
    contextHash: string,
  ) {
    if (!fragments.length) return this.state(threadID);
    return this.db.transaction(() => {
      const state = this.state(threadID);
      if (!state)
        throw new Error(`Thread ${threadID} 尚未建立 prompt baseline`);
      const known = new Set(
        state.fragments.map((fragment) => `${fragment.id}:${fragment.hash}`),
      );
      const added = fragments.filter(
        (fragment) => !known.has(`${fragment.id}:${fragment.hash}`),
      );
      if (!added.length && contextHash === state.contextHash) return state;
      const next = [...state.fragments, ...added];
      // A measured over-budget call schedules compaction at the next safe model
      // boundary. Dynamic prompt diffs must not accidentally clear that latch.
      this.db.sqlite
        .query(
          "UPDATE prompt_session_state SET fragments = ?, context_hash = ?, usage_tokens = 0, usage_source = 'estimated', usage_sample_id = NULL, updated_at = ? WHERE thread_id = ?",
        )
        .run(JSON.stringify(next), contextHash, Date.now(), threadID);
      return this.state(threadID)!;
    });
  }

  usageSamples(threadID: string, limit = 100): ContextUsageSample[] {
    const rows = this.db.sqlite
      .query(
        "SELECT id, thread_id, turn_id, session_id, context_fingerprint, context_window_tokens, input_tokens, output_tokens, source, created_at FROM context_usage_samples WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(threadID, Math.max(1, Math.min(1_000, limit))) as Array<
      Record<string, string | number | null>
    >;
    return rows.map((row) => ({
      id: String(row.id),
      threadID: String(row.thread_id),
      turnID: row.turn_id == null ? null : String(row.turn_id),
      sessionID: row.session_id == null ? null : String(row.session_id),
      contextFingerprint: String(row.context_fingerprint),
      contextWindowTokens: Number(row.context_window_tokens),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      source: String(row.source) as ContextUsageSource,
      createdAt: Number(row.created_at),
    }));
  }

  private insertUsageSample(
    input: Omit<ContextUsageSample, "id" | "createdAt">,
  ) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.sqlite
      .query(
        "INSERT INTO context_usage_samples (id, thread_id, turn_id, session_id, context_fingerprint, context_window_tokens, input_tokens, output_tokens, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.threadID,
        input.turnID,
        input.sessionID,
        input.contextFingerprint,
        input.contextWindowTokens,
        input.inputTokens,
        input.outputTokens,
        input.source,
        createdAt,
      );
    return { ...input, id, createdAt } satisfies ContextUsageSample;
  }

  private updateBudgetState(
    sample: ContextUsageSample,
    preservePending = true,
  ) {
    const { triggerTokens } = thresholds(sample.contextWindowTokens);
    const pending =
      preservePending && Boolean(this.state(sample.threadID)?.needsCompaction);
    const needsCompaction = pending || sample.inputTokens >= triggerTokens;
    const result = this.db.sqlite
      .query(
        "UPDATE prompt_session_state SET context_window_tokens = ?, usage_tokens = ?, usage_source = ?, usage_sample_id = ?, needs_compaction = ?, updated_at = ? WHERE thread_id = ?",
      )
      .run(
        sample.contextWindowTokens,
        sample.inputTokens,
        sample.source,
        sample.id,
        needsCompaction ? 1 : 0,
        sample.createdAt,
        sample.threadID,
      );
    if (!result.changes)
      throw new Error(`Thread ${sample.threadID} 尚未建立 prompt baseline`);
    return needsCompaction;
  }

  recordMeasuredUsage(input: {
    threadID: string;
    turnID?: string;
    sessionID?: string;
    items: AgentInputItem[];
    promptText?: string;
    contextWindowTokens: number;
    inputTokens: number;
    outputTokens?: number;
  }) {
    if (!Number.isInteger(input.inputTokens) || input.inputTokens < 0)
      throw new Error("inputTokens 必须是非负整数");
    if (
      input.outputTokens !== undefined &&
      (!Number.isInteger(input.outputTokens) || input.outputTokens < 0)
    )
      throw new Error("outputTokens 必须是非负整数");
    if (
      !Number.isInteger(input.contextWindowTokens) ||
      input.contextWindowTokens <= 0
    )
      throw new Error("contextWindowTokens 必须是正整数");
    return this.db.transaction(() => {
      const sample = this.insertUsageSample({
        threadID: input.threadID,
        turnID: input.turnID ?? null,
        sessionID: input.sessionID ?? null,
        contextFingerprint: contextFingerprint(input),
        contextWindowTokens: input.contextWindowTokens,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens ?? 0,
        source: "measured",
      });
      this.updateBudgetState(sample);
      return sample;
    });
  }

  snapshot(input: {
    threadID: string;
    turnID?: string;
    sessionID?: string;
    items: AgentInputItem[];
    promptText?: string;
    contextWindowTokens?: number;
  }): ContextBudgetSnapshot {
    const contextWindowTokens =
      input.contextWindowTokens ??
      this.state(input.threadID)?.contextWindowTokens ??
      DEFAULT_CONTEXT_WINDOW_TOKENS;
    const effectiveWindow =
      contextWindowTokens > 0
        ? contextWindowTokens
        : DEFAULT_CONTEXT_WINDOW_TOKENS;
    const currentFingerprint = contextFingerprint(input);
    return this.db.transaction(() => {
      const measured = this.db.sqlite
        .query(
          "SELECT id, thread_id, turn_id, session_id, context_fingerprint, context_window_tokens, input_tokens, output_tokens, source, created_at FROM context_usage_samples WHERE thread_id = ? AND context_fingerprint = ? AND source = 'measured' ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .get(input.threadID, currentFingerprint) as Record<
        string,
        string | number | null
      > | null;
      const sample = measured
        ? {
            id: String(measured.id),
            threadID: String(measured.thread_id),
            turnID: measured.turn_id == null ? null : String(measured.turn_id),
            sessionID:
              measured.session_id == null ? null : String(measured.session_id),
            contextFingerprint: String(measured.context_fingerprint),
            contextWindowTokens: effectiveWindow,
            inputTokens: Number(measured.input_tokens),
            outputTokens: Number(measured.output_tokens),
            source: "measured" as const,
            createdAt: Number(measured.created_at),
          }
        : this.insertUsageSample({
            threadID: input.threadID,
            turnID: input.turnID ?? null,
            sessionID: input.sessionID ?? null,
            contextFingerprint: currentFingerprint,
            contextWindowTokens: effectiveWindow,
            inputTokens: estimateContextTokens(input),
            outputTokens: 0,
            source: "estimated",
          });
      const needsCompaction = this.updateBudgetState(sample);
      const { triggerTokens, targetTokens } = thresholds(effectiveWindow);
      return {
        threadID: input.threadID,
        contextFingerprint: currentFingerprint,
        contextWindowTokens: effectiveWindow,
        usedTokens: sample.inputTokens,
        remainingTokens: Math.max(0, effectiveWindow - sample.inputTokens),
        utilization: sample.inputTokens / effectiveWindow,
        triggerTokens,
        targetTokens,
        needsCompaction,
        source: sample.source,
        sampleID: sample.id,
        sampledAt: sample.createdAt,
      };
    });
  }

}
