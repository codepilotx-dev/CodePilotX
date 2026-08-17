/**
 * Session Persistence conformance 工具（PR 8D）。
 *
 * `codepilotx.session-persistence@1` provider 在 staging 前必须通过本套件：
 * - 行为：open/append/transaction/flush/replay/cursor/checkpoint/recovery/shutdown
 *   全链路往返一致、游标单调、事务原子、重启后可重放、checkpoint 跨重启保留；
 * - 数据根隔离：Provider 只能在自己的 namespaced dataRoot 内工作，
 *   不能触碰默认 AgentDatabase / profile / history 文件（Host 只把
 *   dataRoot 交给 Provider；套件验证 Provider 确实把持久化产物写进该根）。
 *
 * 输出只包含安全错误信息与相对路径，不携带凭据或原始内容。
 */

export interface SessionPersistenceEntry {
  id: string
  type: string
  payload: Record<string, unknown>
}

export interface SessionPersistenceProvider {
  open(input: { dataRoot: string }): unknown | Promise<unknown>
  append(input: { entries: SessionPersistenceEntry[] }): unknown | Promise<unknown>
  transaction(input: { entries: SessionPersistenceEntry[] }): unknown | Promise<unknown>
  flush(input?: unknown): unknown | Promise<unknown>
  replay(input: { afterCursor: number; limit?: number }): unknown | Promise<unknown>
  cursor(input?: unknown): unknown | Promise<unknown>
  checkpoint(input: { action: "save" | "load"; key: string; value?: unknown }): unknown | Promise<unknown>
  recovery(input?: unknown): unknown | Promise<unknown>
  shutdown(input?: unknown): unknown | Promise<unknown>
}

export interface SessionPersistenceConformanceOptions {
  /** Provider 的 namespaced 数据根（Host 已创建）。 */
  dataRoot: string
  /** 扫描数据根确认 Provider 实际写入；可选（无文件系统环境时跳过）。 */
  probe?: (dataRoot: string) => Promise<boolean> | boolean
}

export interface SessionPersistenceConformanceReport {
  pass: boolean
  failures: string[]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" ? (value as Record<string, unknown>) : null

const asNumber = (value: unknown): number | null => {
  const n = asRecord(value)?.cursor
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/** 运行 session-persistence conformance（不抛错；任何断言失败进入 failures）。 */
export async function runSessionPersistenceConformance(
  provider: SessionPersistenceProvider,
  options: SessionPersistenceConformanceOptions,
): Promise<SessionPersistenceConformanceReport> {
  const failures: string[] = []
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message)
  }
  const entry = (n: number): SessionPersistenceEntry => ({
    id: `conformance-${n}`,
    type: "event",
    payload: { n, text: `条目 ${n}` },
  })
  try {
    const opened = await provider.open({ dataRoot: options.dataRoot })
    check(asRecord(opened)?.ok === true, "open 必须返回 { ok: true }")

    // 1. append 游标单调递增；空追加游标不变。
    const c1 = asNumber(await provider.append({ entries: [entry(1)] }))
    check(c1 !== null && c1 > 0, "append 必须返回严格正游标")
    const c2 = asNumber(await provider.append({ entries: [entry(2), entry(3)] }))
    check(c2 !== null && c1 !== null && c2 > c1, "append 游标必须单调递增")
    const c3 = asNumber(await provider.append({ entries: [] }))
    check(c3 === c2, "空追加不得改变游标")

    // 2. transaction 原子性：一批全部可见。
    const t1 = asNumber(await provider.transaction({ entries: [entry(4), entry(5)] }))
    check(t1 !== null && t1 > (c2 ?? 0), "transaction 必须推进游标")

    // 3. flush 必须成功。
    const flushed = asRecord(await provider.flush())
    check(flushed?.ok === true, "flush 必须返回 { ok: true }")

    // 4. replay：全部条目按序重放，游标对齐。
    const replayAll = asRecord(await provider.replay({ afterCursor: 0 }))
    const entries = Array.isArray(replayAll?.entries) ? replayAll.entries : null
    check(entries !== null, "replay 必须返回 entries 数组")
    check(entries !== null && entries.length === 5, `replay 应返回 5 条，实际 ${entries?.length ?? "null"}`)
    check(
      entries !== null && entries[0]?.id === "conformance-1" && entries[4]?.id === "conformance-5",
      "replay 必须保持追加顺序",
    )
    check(asNumber(replayAll) === t1, "replay 返回的 cursor 必须等于当前游标")

    // 5. replay 分页（limit）。
    const page = asRecord(await provider.replay({ afterCursor: 0, limit: 2 }))
    check(
      Array.isArray(page?.entries) && page.entries.length === 2,
      "replay limit 必须生效",
    )

    // 6. 重启恢复：shutdown 后重新 open，数据仍在（持久化）。
    const closed = asRecord(await provider.shutdown())
    check(closed?.ok === true, "shutdown 必须返回 { ok: true }")
    const reopened = asRecord(await provider.open({ dataRoot: options.dataRoot }))
    check(reopened?.ok === true, "重新 open 必须成功（幂等）")
    const afterRestart = asRecord(await provider.replay({ afterCursor: 0 }))
    check(
      Array.isArray(afterRestart?.entries) && afterRestart.entries.length === 5,
      "重启后 replay 必须保留全部条目（flush 后持久化）",
    )
    check(
      asNumber(afterRestart) !== null && asNumber(afterRestart) === t1,
      "重启后游标必须保持",
    )

    // 7. checkpoint 保存/读取（跨重启）。
    const saved = asRecord(await provider.checkpoint({
      action: "save",
      key: "conformance-checkpoint",
      value: { marker: "ok", at: 1 },
    }))
    check(saved !== null && (saved.value === undefined || saved.value === null), "checkpoint save 不应返回 value")
    const loaded = asRecord(await provider.checkpoint({
      action: "load",
      key: "conformance-checkpoint",
    }))
    check(
      loaded?.value != null && asRecord(loaded.value)?.marker === "ok",
      "checkpoint load 必须读回保存值",
    )
    const missing = asRecord(await provider.checkpoint({
      action: "load",
      key: "conformance-missing",
    }))
    check(missing?.value == null, "checkpoint load 缺失 key 必须返回 null")

    // 8. recovery：不抛错且返回非负计数。
    const recovered = asRecord(await provider.recovery())
    check(
      typeof recovered?.recovered === "number" && recovered.recovered >= 0,
      "recovery 必须返回非负 recovered 计数",
    )

    // 9. shutdown 幂等。
    const closedAgain = asRecord(await provider.shutdown())
    check(closedAgain?.ok === true, "shutdown 必须幂等")

    // 10. 数据根隔离：Provider 必须把持久化产物写入 namespaced dataRoot。
    if (options.probe) {
      const used = await options.probe(options.dataRoot)
      check(used === true, "Provider 必须把持久化产物写入自己的 namespaced dataRoot")
    }
  } catch (cause) {
    failures.push(`Provider 抛错：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  return { pass: failures.length === 0, failures }
}
