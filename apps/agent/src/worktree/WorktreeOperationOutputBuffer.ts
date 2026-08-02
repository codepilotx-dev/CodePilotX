const MAX_OUTPUT_BYTES = 64 * 1024
const COMPLETED_TTL_MS = 10 * 60 * 1000

type OutputState = {
  data: Buffer
  oldestCursor: number
  nextCursor: number
  complete: boolean
  expiresAt: number | null
}

/** Ephemeral setup/cleanup output. It is intentionally never written to SQLite, events or logs. */
export class WorktreeOperationOutputBuffer {
  private readonly operations = new Map<string, OutputState>()

  constructor(private readonly now: () => number = Date.now) {}

  append(operationId: string, chunk: string) {
    this.sweep()
    const state = this.operations.get(operationId) ?? {
      data: Buffer.alloc(0),
      oldestCursor: 0,
      nextCursor: 0,
      complete: false,
      expiresAt: null,
    }
    const encoded = Buffer.from(chunk, "utf8")
    state.data = Buffer.concat([state.data, encoded])
    state.nextCursor += encoded.byteLength
    if (state.data.length > MAX_OUTPUT_BYTES) {
      const removed = state.data.length - MAX_OUTPUT_BYTES
      let start = removed
      while (start < state.data.length && (state.data[start]! & 0xc0) === 0x80) start += 1
      state.data = state.data.subarray(start)
      state.oldestCursor = state.nextCursor - state.data.byteLength
    }
    this.operations.set(operationId, state)
  }

  complete(operationId: string) {
    const state = this.operations.get(operationId) ?? {
      data: Buffer.alloc(0),
      oldestCursor: 0,
      nextCursor: 0,
      complete: false,
      expiresAt: null,
    }
    state.complete = true
    state.expiresAt = this.now() + COMPLETED_TTL_MS
    this.operations.set(operationId, state)
  }

  read(operationId: string, afterCursor = 0) {
    this.sweep()
    const state = this.operations.get(operationId)
    if (!state) return { cursor: Math.max(0, afterCursor), data: "", truncated: false, complete: true }
    const safeCursor = Math.max(0, Math.min(afterCursor, state.nextCursor))
    const truncated = safeCursor < state.oldestCursor
    let start = truncated ? 0 : safeCursor - state.oldestCursor
    while (start < state.data.length && (state.data[start]! & 0xc0) === 0x80) start += 1
    return {
      cursor: state.nextCursor,
      data: state.data.subarray(start).toString("utf8"),
      truncated,
      complete: state.complete,
    }
  }

  private sweep() {
    const timestamp = this.now()
    for (const [id, state] of this.operations) {
      if (state.expiresAt !== null && state.expiresAt <= timestamp) this.operations.delete(id)
    }
  }
}
