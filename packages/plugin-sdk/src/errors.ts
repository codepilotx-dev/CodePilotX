/**
 * Plugin SDK 统一错误词汇表。
 *
 * 所有错误跨 v4 边界时只允许携带安全 code + message；原始 stack、路径与
 * 凭据不得离开插件进程。SDK 内部错误与插件进程间 wire 错误使用同一词汇表，
 * 保证跨语言实现可以稳定对照。
 */

/** SDK 可抛出的稳定错误码。新增 code 必须同时更新文档与 JSON Schema 对照。 */
export const PLUGIN_SDK_ERROR_CODES = [
  // ── manifest / ABI ──
  "INVALID_MANIFEST",
  "UNSUPPORTED_SCHEMA_VERSION",
  "INVALID_PLUGIN_ID",
  "INVALID_SEMVER",
  "INVALID_ENGINE_RANGE",
  "ENGINE_INCOMPATIBLE",
  "INVALID_SERVICE_KEY",
  "INVALID_SERVICE_VERSION_RANGE",
  "INVALID_CONFIG_SCHEMA",
  "INVALID_FILE_HASH",
  "INVALID_FILE_PATH",
  "TIER_RUNTIME_MISMATCH",
  "UNKNOWN_CONTRIBUTION",
  "PACK_LIMIT",
  // ── wire / protocol ──
  "PROTOCOL_VERSION_UNSUPPORTED",
  "WIRE_PAYLOAD_NOT_JSON",
  "MESSAGE_TOO_LARGE",
  "MESSAGE_MALFORMED",
  "UNKNOWN_METHOD",
  "INVALID_REQUEST",
  "INITIALIZE_TIMEOUT",
  "SHUTDOWN_TIMEOUT",
  "RPC_TIMEOUT",
  "RPC_CANCELLED",
  "HOST_UNAVAILABLE",
  // ── 生命周期 ──
  "ALREADY_INITIALIZED",
  "NOT_INITIALIZED",
  "ALREADY_DISPOSED",
  "INTERNAL_ERROR",
] as const

export type PluginSdkErrorCode = (typeof PLUGIN_SDK_ERROR_CODES)[number]

export interface PluginSdkErrorOptions {
  code: PluginSdkErrorCode
  /** 面向用户的安全消息；不得包含路径、命令或凭据。 */
  message: string
  retryable?: boolean
  /** SDK 内部定位信息；只允许在 Developer Mode 诊断页展示。 */
  details?: unknown
  cause?: unknown
}

/** SDK 错误。message 是安全文本，details 只用于本地诊断。 */
export class PluginSdkError extends Error {
  readonly code: PluginSdkErrorCode
  readonly retryable: boolean
  readonly details: unknown

  constructor(options: PluginSdkErrorOptions) {
    super(options.message)
    this.name = "PluginSdkError"
    this.code = options.code
    this.retryable = options.retryable ?? false
    this.details = options.details
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
  }

  /** 跨进程安全投影：只保留 code/message/retryable，绝不携带 stack。 */
  toWire(): PluginWireErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    }
  }
}

/** wire 错误形状：安全错误信封，禁止原始 stack 跨进程。 */
export interface PluginWireErrorShape {
  code: string
  message: string
  retryable: boolean
}

/** 把任意 throw 归一化为安全 wire 错误；拒绝泄露内部细节。 */
export function toSafeWireError(cause: unknown): PluginWireErrorShape {
  if (cause instanceof PluginSdkError) return cause.toWire()
  return {
    code: "INTERNAL_ERROR",
    message: "插件内部错误",
    retryable: false,
  }
}
