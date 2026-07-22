import { randomUUID } from "node:crypto"

export const WATCHDOG_INTERVAL_MS = 2_000
export const WATCHDOG_PROBE_TIMEOUT_MS = 1_000
export const WATCHDOG_LOSS_THRESHOLD_MS = 15_000

export type ConnectionLossTrigger = "probe-timeout" | "request-failure" | "child-exit"

export interface WatchdogOutage {
  readonly outageId: string
  readonly failureCount: number
  readonly firstFailureAt: number
  readonly lastFailureAt: number
  readonly lastSuccessAt: number
  readonly elapsedMs: number
  readonly trigger: ConnectionLossTrigger
}

export type WatchdogTransition =
  | { readonly type: "healthy"; readonly lastSuccessAt: number }
  | { readonly type: "degraded"; readonly outage: WatchdogOutage }
  | { readonly type: "recovered"; readonly outage: WatchdogOutage; readonly recoveredAt: number; readonly recoveryDurationMs: number }
  | { readonly type: "lost"; readonly outage: WatchdogOutage }

type WatchdogSuccessTransition = Extract<WatchdogTransition, { type: "healthy" | "recovered" }>
type WatchdogFailureTransition = Extract<WatchdogTransition, { type: "degraded" | "lost" }>
type WatchdogLostTransition = Extract<WatchdogTransition, { type: "lost" }>

interface WatchdogStateOptions {
  readonly lossThresholdMs?: number
  readonly createOutageId?: () => string
  readonly startedAt?: number
}

export class ConnectionWatchdogState {
  readonly #lossThresholdMs: number
  readonly #createOutageId: () => string
  #lastSuccessAt: number
  #outage: Omit<WatchdogOutage, "elapsedMs"> | undefined
  #lost = false

  constructor(options: WatchdogStateOptions = {}) {
    this.#lossThresholdMs = options.lossThresholdMs ?? WATCHDOG_LOSS_THRESHOLD_MS
    this.#createOutageId = options.createOutageId ?? randomUUID
    this.#lastSuccessAt = options.startedAt ?? Date.now()
  }

  success(at = Date.now()): WatchdogSuccessTransition {
    const outage = this.#outage
    this.#lastSuccessAt = at
    this.#outage = undefined
    this.#lost = false
    if (!outage) return { type: "healthy", lastSuccessAt: at }
    const recoveredOutage = this.#snapshot(outage, at)
    return {
      type: "recovered",
      outage: recoveredOutage,
      recoveredAt: at,
      recoveryDurationMs: Math.max(0, at - outage.firstFailureAt),
    }
  }

  failure(at = Date.now(), trigger: Exclude<ConnectionLossTrigger, "child-exit"> = "probe-timeout"): WatchdogFailureTransition {
    if (!this.#outage) {
      this.#outage = {
        outageId: this.#createOutageId(),
        failureCount: 1,
        firstFailureAt: at,
        lastFailureAt: at,
        lastSuccessAt: this.#lastSuccessAt,
        trigger,
      }
    } else {
      this.#outage = {
        ...this.#outage,
        failureCount: this.#outage.failureCount + 1,
        lastFailureAt: at,
        trigger,
      }
    }
    const outage = this.#snapshot(this.#outage, at)
    if (this.#lost || outage.elapsedMs >= this.#lossThresholdMs) {
      this.#lost = true
      return { type: "lost", outage }
    }
    return { type: "degraded", outage }
  }

  childExited(at = Date.now()): WatchdogLostTransition {
    if (!this.#outage) {
      this.#outage = {
        outageId: this.#createOutageId(),
        failureCount: 0,
        firstFailureAt: at,
        lastFailureAt: at,
        lastSuccessAt: this.#lastSuccessAt,
        trigger: "child-exit",
      }
    } else {
      this.#outage = { ...this.#outage, lastFailureAt: at, trigger: "child-exit" }
    }
    this.#lost = true
    return { type: "lost", outage: this.#snapshot(this.#outage, at) }
  }

  #snapshot(
    outage: Omit<WatchdogOutage, "elapsedMs">,
    at: number,
  ): WatchdogOutage {
    return {
      ...outage,
      elapsedMs: Math.max(0, at - outage.firstFailureAt),
    }
  }
}

export function shouldLoadApplication(
  currentOrigin: string | undefined,
  candidateOrigin: string,
  applicationLoaded: boolean,
): boolean {
  return !applicationLoaded || currentOrigin !== candidateOrigin
}

export function shouldDisposeOwnedSidecar(managed: boolean): boolean {
  return !managed
}

export function watchdogDiagnosticFields(
  connection: { readonly origin: string; readonly managed: boolean },
  outage: WatchdogOutage,
): Record<string, unknown> {
  return {
    outageId: outage.outageId,
    origin: connection.origin,
    managed: connection.managed,
    trigger: outage.trigger,
    failureCount: outage.failureCount,
    elapsedMs: outage.elapsedMs,
    firstFailureAt: new Date(outage.firstFailureAt).toISOString(),
    lastFailureAt: new Date(outage.lastFailureAt).toISOString(),
    lastSuccessAt: new Date(outage.lastSuccessAt).toISOString(),
  }
}
