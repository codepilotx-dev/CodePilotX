/** 插件 fixture 构造：manifest 与包文件内容。 */

import { createHash } from "node:crypto"

export const sha256Text = (content: string) => createHash("sha256").update(content, "utf8").digest("hex")

export const makeManifest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: "acme.hello",
  version: "1.0.0",
  displayName: "Hello Plugin",
  description: "示例插件",
  publisher: "acme",
  engines: { pluginApi: "^1" },
  tier: "application",
  runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "index.ts" },
  files: {} as Record<string, string>,
  ...overrides,
})

/** 构造带 files 清单的完整包内容（manifest.json 自包含；其 files 值为合法占位 hash）。 */
export const makePluginPackage = (inputs: Array<{ path: string; content: string }>, overrides: Record<string, unknown> = {}): {
  files: Array<{ path: string; content: string }>
  manifestJson: string
} => {
  const manifestBase = makeManifest(overrides)
  const files: Record<string, string> = {}
  const entries: Array<{ path: string; content: string }> = []
  for (const input of inputs) {
    files[input.path] = sha256Text(input.content)
    entries.push(input)
  }
  // manifest.json 的 hash 自指无法成立；files 值使用合法 64-hex 占位，
  // 安装器对 manifest.json 只做解析校验（见 installer.ts）。
  files["manifest.json"] = "0".repeat(64)
  const manifest = { ...manifestBase, files }
  const manifestJson = JSON.stringify(manifest, null, 2)
  entries.push({ path: "manifest.json", content: manifestJson })
  return { files: entries, manifestJson }
}
