import type { AgentInputItem } from "@openai/agents"
import type { AgentDatabase } from "../storage/Database"
import { SqliteAgentSession, userRoundStarts } from "../storage/SqliteAgentSession"

export type ContextFragmentKind = "mode" | "permission" | "settings" | "project" | "skill" | "memory" | "subagent" | "plan"

export type ContextFragment = {
  id: string
  kind: ContextFragmentKind
  version: number
  hash: string
  payload: unknown
  createdAt: number
}

export type PromptSessionState = {
  threadID: string
  baselineVersion: number
  promptVersion: string
  baseHash: string
  contextHash: string
  cacheKey: string
  fragments: ContextFragment[]
  contextWindowTokens: number
  usageTokens: number
  usageSource: ContextUsageSource
  usageSampleID: string | null
  needsCompaction: boolean
  createdAt: number
  updatedAt: number
}

export type EstablishBaselineInput = Pick<PromptSessionState, "threadID" | "promptVersion" | "baseHash" | "contextHash" | "cacheKey"> & { fragments?: ContextFragment[] }

export type CompactionResult = {
  summary: string
  replacementHistory: AgentInputItem[]
}

export interface ContextCompactor {
  compact(input: { items: AgentInputItem[]; preserveRecentUserTurns: number; targetRatio: number; targetTokens: number; signal?: AbortSignal }): Promise<CompactionResult>
}

export type ContextUsageSource = "measured" | "estimated" | "compaction-estimate"

export type ContextUsageSample = {
  id: string
  threadID: string
  turnID: string | null
  sessionID: string | null
  contextFingerprint: string
  contextWindowTokens: number
  inputTokens: number
  outputTokens: number
  source: ContextUsageSource
  createdAt: number
}

export type ContextBudgetSnapshot = {
  threadID: string
  contextFingerprint: string
  contextWindowTokens: number
  usedTokens: number
  remainingTokens: number
  utilization: number
  triggerTokens: number
  targetTokens: number
  needsCompaction: boolean
  source: ContextUsageSource
  sampleID: string
  sampledAt: number
}

const parse = <T>(value: string) => JSON.parse(value) as T
const MAX_VISIBLE_TOOL_OUTPUT_CHARS = 80_000
export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.8
export const CONTEXT_COMPACTION_TARGET_RATIO = 0.55
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]))
  return value
}

const stableStringify = (value: unknown) => JSON.stringify(canonicalize(value))
const fingerprint = (value: unknown) => new Bun.CryptoHasher("sha256").update(stableStringify(value)).digest("hex")

export const estimateContextTokens = (input: { items: AgentInputItem[]; promptText?: string }) => {
  const bytes = new TextEncoder().encode(stableStringify({ items: input.items, promptText: input.promptText ?? "" })).byteLength
  return Math.max(1, Math.ceil(bytes / 4) + input.items.length * 4)
}

export const contextFingerprint = (input: { items: AgentInputItem[]; promptText?: string }) => fingerprint({ items: input.items, promptText: input.promptText ?? "" })

const thresholds = (contextWindowTokens: number) => ({
  triggerTokens: Math.ceil(contextWindowTokens * CONTEXT_COMPACTION_TRIGGER_RATIO),
  targetTokens: Math.floor(contextWindowTokens * CONTEXT_COMPACTION_TARGET_RATIO),
})

const truncateText = (value: string, limit = MAX_VISIBLE_TOOL_OUTPUT_CHARS) => {
  if (value.length <= limit) return value
  const marker = `\n…[${value.length - limit} chars omitted]…\n`
  const remaining = Math.max(0, limit - marker.length)
  const head = Math.ceil(remaining / 2)
  return value.slice(0, head) + marker + value.slice(value.length - (remaining - head))
}

/** Keeps tool evidence bounded while retaining both failure prelude and useful tail. */
export const boundModelVisibleOutputs = (items: AgentInputItem[]): AgentInputItem[] => items.map((item) => {
  if (!item || typeof item !== "object") return item
  const record = { ...(item as unknown as Record<string, unknown>) }
  for (const key of ["output", "content", "result"]) {
    if (typeof record[key] === "string") record[key] = truncateText(record[key] as string)
  }
  return record as unknown as AgentInputItem
})

const fitReplacementToBudget = (items: AgentInputItem[], promptText: string | undefined, targetTokens: number) => {
  const replacement = structuredClone(items)
  const tokens = () => estimateContextTokens({ items: replacement, ...(promptText === undefined ? {} : { promptText }) })
  while (tokens() > targetTokens) {
    const starts = userRoundStarts(replacement)
    if (starts.length > 4) {
      replacement.splice(starts[0]!, starts[1]! - starts[0]!)
      continue
    }
    const strings: Array<{ path: string; value: string; set(value: string): void }> = []
    const visit = (value: unknown, path: string): void => {
      if (!value || typeof value !== "object") return
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const record = value as Record<string, unknown>
        const child = record[key]
        const childPath = `${path}.${key}`
        if (typeof child === "string" && child.length > 256) strings.push({ path: childPath, value: child, set: (next) => { record[key] = next } })
        else visit(child, childPath)
      }
    }
    replacement.forEach((item, index) => visit(item, String(index)))
    strings.sort((left, right) => right.value.length - left.value.length || left.path.localeCompare(right.path))
    const candidate = strings[0]
    if (!candidate) throw new Error(`压缩结果无法确定性裁剪到 55% 目标预算 (${tokens()}/${targetTokens})`)
    const excessChars = Math.max(256, (tokens() - targetTokens) * 4)
    candidate.set(truncateText(candidate.value, Math.max(256, candidate.value.length - excessChars)))
  }
  return replacement
}

export class ContextManager {
  constructor(private readonly db: AgentDatabase) {}

  state(threadID: string): PromptSessionState | null {
    const row = this.db.sqlite.query("SELECT thread_id, baseline_version, prompt_version, base_hash, context_hash, cache_key, fragments, context_window_tokens, usage_tokens, usage_source, usage_sample_id, needs_compaction, created_at, updated_at FROM prompt_session_state WHERE thread_id = ?").get(threadID) as Record<string, string | number | null> | null
    return row ? {
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
      usageSampleID: row.usage_sample_id == null ? null : String(row.usage_sample_id),
      needsCompaction: Boolean(row.needs_compaction),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    } : null
  }

  establishBaseline(input: EstablishBaselineInput) {
    const timestamp = Date.now()
    return this.db.transaction(() => {
      const previous = this.state(input.threadID)
      const baselineVersion = (previous?.baselineVersion ?? 0) + 1
      this.db.sqlite.query(`INSERT INTO prompt_session_state (thread_id, baseline_version, prompt_version, base_hash, context_hash, cache_key, fragments, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET baseline_version = excluded.baseline_version, prompt_version = excluded.prompt_version, base_hash = excluded.base_hash, context_hash = excluded.context_hash, cache_key = excluded.cache_key, fragments = excluded.fragments, usage_tokens = 0, usage_source = 'estimated', usage_sample_id = NULL, needs_compaction = 0, updated_at = excluded.updated_at`).run(
        input.threadID, baselineVersion, input.promptVersion, input.baseHash, input.contextHash, input.cacheKey,
        JSON.stringify(input.fragments ?? []), previous?.createdAt ?? timestamp, timestamp,
      )
      return this.state(input.threadID)!
    })
  }

  appendFragments(threadID: string, fragments: ContextFragment[], contextHash: string) {
    if (!fragments.length) return this.state(threadID)
    return this.db.transaction(() => {
      const state = this.state(threadID)
      if (!state) throw new Error(`Thread ${threadID} 尚未建立 prompt baseline`)
      const known = new Set(state.fragments.map((fragment) => `${fragment.id}:${fragment.hash}`))
      const added = fragments.filter((fragment) => !known.has(`${fragment.id}:${fragment.hash}`))
      if (!added.length && contextHash === state.contextHash) return state
      const next = [...state.fragments, ...added]
      // A measured over-budget call schedules compaction at the next safe model
      // boundary. Dynamic prompt diffs must not accidentally clear that latch.
      this.db.sqlite.query("UPDATE prompt_session_state SET fragments = ?, context_hash = ?, usage_tokens = 0, usage_source = 'estimated', usage_sample_id = NULL, updated_at = ? WHERE thread_id = ?").run(JSON.stringify(next), contextHash, Date.now(), threadID)
      return this.state(threadID)!
    })
  }

  usageSamples(threadID: string, limit = 100): ContextUsageSample[] {
    const rows = this.db.sqlite.query("SELECT id, thread_id, turn_id, session_id, context_fingerprint, context_window_tokens, input_tokens, output_tokens, source, created_at FROM context_usage_samples WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(threadID, Math.max(1, Math.min(1_000, limit))) as Array<Record<string, string | number | null>>
    return rows.map((row) => ({
      id: String(row.id), threadID: String(row.thread_id), turnID: row.turn_id == null ? null : String(row.turn_id), sessionID: row.session_id == null ? null : String(row.session_id),
      contextFingerprint: String(row.context_fingerprint), contextWindowTokens: Number(row.context_window_tokens), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens),
      source: String(row.source) as ContextUsageSource, createdAt: Number(row.created_at),
    }))
  }

  private insertUsageSample(input: Omit<ContextUsageSample, "id" | "createdAt">) {
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    this.db.sqlite.query("INSERT INTO context_usage_samples (id, thread_id, turn_id, session_id, context_fingerprint, context_window_tokens, input_tokens, output_tokens, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, input.threadID, input.turnID, input.sessionID, input.contextFingerprint, input.contextWindowTokens, input.inputTokens, input.outputTokens, input.source, createdAt,
    )
    return { ...input, id, createdAt } satisfies ContextUsageSample
  }

  private updateBudgetState(sample: ContextUsageSample, preservePending = true) {
    const { triggerTokens } = thresholds(sample.contextWindowTokens)
    const pending = preservePending && Boolean(this.state(sample.threadID)?.needsCompaction)
    const needsCompaction = pending || sample.inputTokens >= triggerTokens
    const result = this.db.sqlite.query("UPDATE prompt_session_state SET context_window_tokens = ?, usage_tokens = ?, usage_source = ?, usage_sample_id = ?, needs_compaction = ?, updated_at = ? WHERE thread_id = ?").run(
      sample.contextWindowTokens, sample.inputTokens, sample.source, sample.id, needsCompaction ? 1 : 0, sample.createdAt, sample.threadID,
    )
    if (!result.changes) throw new Error(`Thread ${sample.threadID} 尚未建立 prompt baseline`)
    return needsCompaction
  }

  recordMeasuredUsage(input: { threadID: string; turnID?: string; sessionID?: string; items: AgentInputItem[]; promptText?: string; contextWindowTokens: number; inputTokens: number; outputTokens?: number }) {
    if (!Number.isInteger(input.inputTokens) || input.inputTokens < 0) throw new Error("inputTokens 必须是非负整数")
    if (input.outputTokens !== undefined && (!Number.isInteger(input.outputTokens) || input.outputTokens < 0)) throw new Error("outputTokens 必须是非负整数")
    if (!Number.isInteger(input.contextWindowTokens) || input.contextWindowTokens <= 0) throw new Error("contextWindowTokens 必须是正整数")
    return this.db.transaction(() => {
      const sample = this.insertUsageSample({
        threadID: input.threadID, turnID: input.turnID ?? null, sessionID: input.sessionID ?? null,
        contextFingerprint: contextFingerprint(input), contextWindowTokens: input.contextWindowTokens, inputTokens: input.inputTokens,
        outputTokens: input.outputTokens ?? 0, source: "measured",
      })
      this.updateBudgetState(sample)
      return sample
    })
  }

  snapshot(input: { threadID: string; turnID?: string; sessionID?: string; items: AgentInputItem[]; promptText?: string; contextWindowTokens?: number }): ContextBudgetSnapshot {
    const contextWindowTokens = input.contextWindowTokens ?? this.state(input.threadID)?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
    const effectiveWindow = contextWindowTokens > 0 ? contextWindowTokens : DEFAULT_CONTEXT_WINDOW_TOKENS
    const currentFingerprint = contextFingerprint(input)
    return this.db.transaction(() => {
      const measured = this.db.sqlite.query("SELECT id, thread_id, turn_id, session_id, context_fingerprint, context_window_tokens, input_tokens, output_tokens, source, created_at FROM context_usage_samples WHERE thread_id = ? AND context_fingerprint = ? AND source = 'measured' ORDER BY created_at DESC, id DESC LIMIT 1").get(input.threadID, currentFingerprint) as Record<string, string | number | null> | null
      const sample = measured ? {
        id: String(measured.id), threadID: String(measured.thread_id), turnID: measured.turn_id == null ? null : String(measured.turn_id), sessionID: measured.session_id == null ? null : String(measured.session_id),
        contextFingerprint: String(measured.context_fingerprint), contextWindowTokens: effectiveWindow, inputTokens: Number(measured.input_tokens), outputTokens: Number(measured.output_tokens), source: "measured" as const, createdAt: Number(measured.created_at),
      } : this.insertUsageSample({
        threadID: input.threadID, turnID: input.turnID ?? null, sessionID: input.sessionID ?? null, contextFingerprint: currentFingerprint,
        contextWindowTokens: effectiveWindow, inputTokens: estimateContextTokens(input), outputTokens: 0, source: "estimated",
      })
      const needsCompaction = this.updateBudgetState(sample)
      const { triggerTokens, targetTokens } = thresholds(effectiveWindow)
      return {
        threadID: input.threadID, contextFingerprint: currentFingerprint, contextWindowTokens: effectiveWindow, usedTokens: sample.inputTokens,
        remainingTokens: Math.max(0, effectiveWindow - sample.inputTokens), utilization: sample.inputTokens / effectiveWindow,
        triggerTokens, targetTokens, needsCompaction, source: sample.source, sampleID: sample.id, sampledAt: sample.createdAt,
      }
    })
  }

  async compact(input: { threadID: string; turnID?: string; session: SqliteAgentSession; compactor: ContextCompactor; promptText?: string; contextWindowTokens?: number; signal?: AbortSignal }) {
    const original = await input.session.getItems()
    const sessionID = await input.session.getSessionId()
    const stateBefore = this.state(input.threadID)
    const contextWindowTokens = input.contextWindowTokens ?? stateBefore?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
    const effectiveWindow = contextWindowTokens > 0 ? contextWindowTokens : DEFAULT_CONTEXT_WINDOW_TOKENS
    const { targetTokens, triggerTokens } = thresholds(effectiveWindow)
    const originalFingerprint = contextFingerprint({ items: original, ...(input.promptText !== undefined ? { promptText: input.promptText } : {}) })
    const measured = this.db.sqlite.query("SELECT input_tokens FROM context_usage_samples WHERE thread_id = ? AND context_fingerprint = ? AND source = 'measured' ORDER BY created_at DESC, id DESC LIMIT 1").get(input.threadID, originalFingerprint) as { input_tokens: number } | null
    const beforeTokens = measured?.input_tokens ?? estimateContextTokens({ items: original, ...(input.promptText !== undefined ? { promptText: input.promptText } : {}) })
    const result = await input.compactor.compact({ items: boundModelVisibleOutputs(original), preserveRecentUserTurns: 4, targetRatio: CONTEXT_COMPACTION_TARGET_RATIO, targetTokens, ...(input.signal ? { signal: input.signal } : {}) })
    if (!result.summary.trim() || !result.replacementHistory.length) throw new Error("压缩器返回了空 history")
    const replacement = fitReplacementToBudget(boundModelVisibleOutputs(result.replacementHistory), input.promptText, targetTokens)
    const replacementFingerprint = contextFingerprint({ items: replacement, ...(input.promptText !== undefined ? { promptText: input.promptText } : {}) })
    const afterTokens = estimateContextTokens({ items: replacement, ...(input.promptText !== undefined ? { promptText: input.promptText } : {}) })
    if (afterTokens > targetTokens) throw new Error(`压缩结果仍超过 55% 目标预算 (${afterTokens}/${targetTokens})`)
    const timestamp = Date.now()
    const id = crypto.randomUUID()
    let usageSampleID = ""
    this.db.transaction(() => {
      this.db.sqlite.query("DELETE FROM agent_thread_items WHERE thread_id = ?").run(sessionID)
      const insert = this.db.sqlite.query("INSERT INTO agent_thread_items (thread_id, ordinal, payload, created_at) VALUES (?, ?, ?, ?)")
      replacement.forEach((item, ordinal) => insert.run(sessionID, ordinal, JSON.stringify(item), timestamp))
      const state = this.state(input.threadID)
      const baselineVersion = (state?.baselineVersion ?? 0) + 1
      if (state) this.db.sqlite.query("UPDATE prompt_session_state SET baseline_version = ?, fragments = '[]', updated_at = ? WHERE thread_id = ?").run(baselineVersion, timestamp, input.threadID)
      const usage = this.insertUsageSample({
        threadID: input.threadID, turnID: input.turnID ?? null, sessionID, contextFingerprint: replacementFingerprint,
        contextWindowTokens: effectiveWindow, inputTokens: afterTokens, outputTokens: 0, source: "compaction-estimate",
      })
      usageSampleID = usage.id
      this.updateBudgetState(usage, false)
      this.db.sqlite.query("INSERT INTO agent_compactions (id, thread_id, turn_id, baseline_version, before_count, after_count, summary, replacement_history, created_at, before_tokens, after_tokens, target_tokens, usage_sample_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        id, input.threadID, input.turnID ?? null, baselineVersion, original.length, replacement.length, truncateText(result.summary, 40_000), JSON.stringify(replacement), timestamp,
        beforeTokens, afterTokens, targetTokens, usage.id,
      )
      this.db.insertEvent(input.threadID, input.turnID ?? null, "context/compacted", { id, beforeCount: original.length, afterCount: replacement.length, beforeTokens, afterTokens, targetTokens, triggerTokens, usageSampleID: usage.id, baselineVersion, createdAt: timestamp })
    })
    return { id, beforeCount: original.length, afterCount: replacement.length, beforeTokens, afterTokens, targetTokens, usageSampleID, baselineVersion: (this.state(input.threadID)?.baselineVersion ?? 1) }
  }

  /** Retries prompt-too-long at most three times, removing one oldest complete round per retry. */
  async withPromptTooLongRecovery<T>(input: { session: SqliteAgentSession; run: () => Promise<T>; isPromptTooLong: (cause: unknown) => boolean }) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await input.run() } catch (cause) {
        if (!input.isPromptTooLong(cause) || attempt >= 3) throw cause
        const removed = await input.session.dropOldestRound()
        if (!removed) throw cause
      }
    }
  }
}
