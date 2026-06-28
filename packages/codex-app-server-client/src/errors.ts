/**
 * Errors raised by the Codex app-server client.
 */

export class CodexAppServerError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'CodexAppServerError'
  }
}

export class CodexAppServerConnectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'CodexAppServerConnectionError'
  }
}

export class CodexAppServerTimeoutError extends Error {
  constructor(public readonly method: string, public readonly timeoutMs: number) {
    super(`Codex app-server request ${method} timed out after ${timeoutMs}ms`)
    this.name = 'CodexAppServerTimeoutError'
  }
}