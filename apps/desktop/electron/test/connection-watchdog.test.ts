import { describe, expect, test } from "bun:test"
import {
  ConnectionWatchdogState,
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_LOSS_THRESHOLD_MS,
  WATCHDOG_PROBE_TIMEOUT_MS,
  shouldDisposeOwnedSidecar,
  shouldLoadApplication,
  watchdogDiagnosticFields,
} from "../src/connection-watchdog"

describe("Electron Agent watchdog", () => {
  test("使用 2 秒探测、1 秒超时并要求持续失败 15 秒", () => {
    expect(WATCHDOG_INTERVAL_MS).toBe(2_000)
    expect(WATCHDOG_PROBE_TIMEOUT_MS).toBe(1_000)
    expect(WATCHDOG_LOSS_THRESHOLD_MS).toBe(15_000)

    const state = new ConnectionWatchdogState({
      startedAt: 0,
      createOutageId: () => "outage-1",
    })

    const first = state.failure(100)
    expect(first).toMatchObject({
      type: "degraded",
      outage: { outageId: "outage-1", failureCount: 1, elapsedMs: 0 },
    })
    expect(state.failure(15_099)).toMatchObject({
      type: "degraded",
      outage: { failureCount: 2, elapsedMs: 14_999 },
    })
    expect(state.failure(15_100)).toMatchObject({
      type: "lost",
      outage: { failureCount: 3, elapsedMs: 15_000, trigger: "probe-timeout" },
    })
  })

  test("短暂故障恢复时保留 outage 诊断且不判定丢失", () => {
    let outageSequence = 0
    const state = new ConnectionWatchdogState({
      startedAt: 1_000,
      createOutageId: () => `outage-${++outageSequence}`,
    })

    expect(state.failure(2_000).type).toBe("degraded")
    expect(state.failure(4_000).type).toBe("degraded")
    expect(state.success(4_250)).toEqual({
      type: "recovered",
      outage: {
        outageId: "outage-1",
        failureCount: 2,
        firstFailureAt: 2_000,
        lastFailureAt: 4_000,
        lastSuccessAt: 1_000,
        elapsedMs: 2_250,
        trigger: "probe-timeout",
      },
      recoveredAt: 4_250,
      recoveryDurationMs: 2_250,
    })
    expect(state.failure(5_000)).toMatchObject({
      type: "degraded",
      outage: { outageId: "outage-2", lastSuccessAt: 4_250 },
    })
  })

  test("owned child 退出立即判定丢失，不等待探测阈值", () => {
    const state = new ConnectionWatchdogState({
      startedAt: 1_000,
      createOutageId: () => "child-exit-outage",
    })

    expect(state.childExited(1_001)).toEqual({
      type: "lost",
      outage: {
        outageId: "child-exit-outage",
        failureCount: 0,
        firstFailureAt: 1_001,
        lastFailureAt: 1_001,
        lastSuccessAt: 1_000,
        elapsedMs: 0,
        trigger: "child-exit",
      },
    })
  })

  test("区分探测超时、HTTP 请求失败和 owned child 退出", () => {
    const state = new ConnectionWatchdogState({
      startedAt: 1_000,
      createOutageId: () => "classified-outage",
    })

    expect(state.failure(2_000, "request-failure")).toMatchObject({
      type: "degraded",
      outage: { trigger: "request-failure" },
    })
    expect(state.failure(3_000, "probe-timeout")).toMatchObject({
      type: "degraded",
      outage: { trigger: "probe-timeout" },
    })
    expect(state.childExited(3_001)).toMatchObject({
      type: "lost",
      outage: { trigger: "child-exit" },
    })
  })

  test("同 origin 恢复复用 renderer，managed Agent 不进入子进程终止路径", () => {
    expect(shouldLoadApplication("http://127.0.0.1:4317", "http://127.0.0.1:4317", true)).toBe(false)
    expect(shouldLoadApplication("http://127.0.0.1:4317", "http://127.0.0.1:4318", true)).toBe(true)
    expect(shouldLoadApplication("http://127.0.0.1:4317", "http://127.0.0.1:4317", false)).toBe(true)
    expect(shouldDisposeOwnedSidecar(true)).toBe(false)
    expect(shouldDisposeOwnedSidecar(false)).toBe(true)
  })

  test("watchdog 日志只包含连接和 outage 诊断字段", () => {
    const transition = new ConnectionWatchdogState({
      startedAt: 1_000,
      createOutageId: () => "safe-outage",
    }).failure(2_000)

    expect(watchdogDiagnosticFields({ origin: "http://127.0.0.1:4317", managed: true }, transition.outage)).toEqual({
      outageId: "safe-outage",
      origin: "http://127.0.0.1:4317",
      managed: true,
      trigger: "probe-timeout",
      failureCount: 1,
      elapsedMs: 0,
      firstFailureAt: "1970-01-01T00:00:02.000Z",
      lastFailureAt: "1970-01-01T00:00:02.000Z",
      lastSuccessAt: "1970-01-01T00:00:01.000Z",
    })
  })
})
