/**
 * JSON Schema 的最小结构化子集。
 *
 * Manifest 的 configSchema、service 方法的 input/output 与工具 inputSchema
 * 必须能用 JSON 表达（wire 不接受 function/undefined/非 JSON 类型）。
 * 这里只做结构约束；具体关键字语义由 Host 侧的 JSON Schema 校验器解释。
 */

/** JSON 值（Effect Schema.Json 的 Type 别名，避免直接依赖 effect 类型）。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/**
 * JSON Schema 文档（Draft-07 子集）。SDK 不解析 $ref；跨语言实现应把
 * $ref 视为 Host 决定的能力，首版约定 configSchema 必须内联可校验。
 */
export type JsonSchema = {
  $schema?: string
  $id?: string
  $ref?: string
  title?: string
  description?: string
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  enum?: JsonValue[]
  const?: JsonValue
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  not?: JsonSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  minItems?: number
  maxItems?: number
  default?: JsonValue
}

/** 判断值是否为 JSON 可表达对象（拒绝 undefined/function/symbol/BigInt/循环）。 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  switch (typeof value) {
    case "boolean":
    case "string":
      return true
    case "number":
      return Number.isFinite(value)
    case "object": {
      if (Array.isArray(value)) return value.every(isJsonValue)
      if (value instanceof Date || value instanceof RegExp) return false
      for (const key of Object.keys(value)) {
        if (!isJsonValue((value as Record<string, unknown>)[key])) return false
      }
      return true
    }
    default:
      return false
  }
}

export function isJsonSchemaObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
