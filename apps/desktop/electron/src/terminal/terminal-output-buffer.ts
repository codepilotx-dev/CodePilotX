import type { DesktopTerminalChunk } from "@codepilotx/shared/desktop-terminal-ipc"

export interface TerminalReplay {
  oldestSequence: number
  nextSequence: number
  chunks: readonly DesktopTerminalChunk[]
  gap: boolean
  truncated: boolean
}

export class TerminalOutputBuffer {
  readonly #maximumBytes: number
  readonly #terminalId: string
  readonly #instanceId: string
  readonly #chunks: Array<DesktopTerminalChunk & { bytes: number }> = []
  #nextSequence = 0
  #totalBytes = 0
  #truncated = false

  constructor(terminalId: string, instanceId: string, maximumBytes = 1_048_576) {
    this.#terminalId = terminalId
    this.#instanceId = instanceId
    this.#maximumBytes = maximumBytes
  }

  append(data: string): DesktopTerminalChunk {
    const sequence = this.#nextSequence++
    const normalizedData = trimUtf8Tail(data, this.#maximumBytes)
    const bytes = Buffer.byteLength(normalizedData, "utf8")
    const chunk = {
      terminalId: this.#terminalId,
      instanceId: this.#instanceId,
      sequence,
      data: normalizedData,
      bytes,
    }
    this.#chunks.push(chunk)
    this.#totalBytes += bytes
    while (this.#totalBytes > this.#maximumBytes && this.#chunks.length > 1) {
      const removed = this.#chunks.shift()
      if (removed) this.#totalBytes -= removed.bytes
      this.#truncated = true
    }
    if (Buffer.byteLength(data, "utf8") > bytes) this.#truncated = true
    return chunk
  }

  replay(afterSequence: number): TerminalReplay {
    const oldestSequence = this.#chunks[0]?.sequence ?? this.#nextSequence
    const gap = afterSequence < oldestSequence - 1
    const chunks = this.#chunks
      .filter(chunk => chunk.sequence > afterSequence)
      .map(({ bytes: _bytes, ...chunk }) => chunk)
    return {
      oldestSequence,
      nextSequence: this.#nextSequence,
      chunks,
      gap,
      truncated: this.#truncated,
    }
  }

  clear(): void {
    this.#chunks.length = 0
    this.#totalBytes = 0
  }
}

function trimUtf8Tail(value: string, maximumBytes: number): string {
  const encoded = Buffer.from(value, "utf8")
  if (encoded.byteLength <= maximumBytes) return value
  let start = encoded.byteLength - maximumBytes
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) start += 1
  return encoded.subarray(start).toString("utf8")
}
