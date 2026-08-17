/**
 * Manifest conformance 工具：供 SDK 测试与跨语言 SDK 对照使用。
 *
 * 输出只包含安全错误码与路径，不携带原始输入值。
 */

import { validateManifest, type ManifestValidationError, type PluginManifestV1 } from "../manifest"

export interface ManifestConformanceReport {
  valid: boolean
  errors: ManifestValidationError[]
  /** 合法时返回规范化后的 manifest（校验通过的原样对象）。 */
  manifest: PluginManifestV1 | null
}

/** 运行 manifest conformance 校验（不抛错）。 */
export function runManifestConformance(input: unknown): ManifestConformanceReport {
  const result = validateManifest(input)
  if (result.ok) return { valid: true, errors: [], manifest: result.manifest }
  return { valid: false, errors: result.errors, manifest: null }
}
