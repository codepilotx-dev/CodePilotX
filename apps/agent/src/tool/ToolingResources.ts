import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

type ToolingManifestEntry = {
  id: string
  platform: string
  arch: string
  required: boolean
  executable: string
  license: string
  sha256?: string
}

type ToolingManifest = { version: number; tools: ToolingManifestEntry[] }

export type ToolingResolution =
  | { available: true; path: string; entry: ToolingManifestEntry }
  | { available: false; reason: string }

export const toolingRoot = () => {
  const explicit = process.env.CODEPILOTX_TOOLING_ROOT?.trim()
  if (explicit) return resolve(explicit)
  const packaged = resolve(process.cwd(), "tooling")
  if (existsSync(join(packaged, "manifest.json"))) return packaged
  return resolve(process.cwd(), "resources", "tooling")
}

const contained = (root: string, path: string) => {
  const child = relative(root, path)
  return child !== "" && !child.startsWith("..") && !isAbsolute(child)
}

export const resolveToolingExecutable = (id: string): ToolingResolution => {
  const root = toolingRoot()
  const manifestPath = join(root, "manifest.json")
  if (!existsSync(manifestPath)) return { available: false, reason: `tooling manifest 不存在：${manifestPath}` }
  let manifest: ToolingManifest
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ToolingManifest } catch { return { available: false, reason: "tooling manifest 无法解析" } }
  const entry = manifest.tools.find((candidate) => candidate.id === id && candidate.platform === process.platform && candidate.arch === process.arch)
  if (!entry) return { available: false, reason: `tooling manifest 未声明 ${id}/${process.platform}/${process.arch}` }
  const executable = resolve(root, entry.executable)
  const license = resolve(root, entry.license)
  if (!contained(root, executable) || !contained(root, license)) return { available: false, reason: `${id} manifest 路径越界` }
  if (!existsSync(executable) || !statSync(executable).isFile()) return { available: false, reason: `${id} executable 缺失` }
  if (!existsSync(license) || !statSync(license).isFile()) return { available: false, reason: `${id} license 缺失` }
  if (!entry.sha256 || !/^[a-f\d]{64}$/i.test(entry.sha256)) return { available: false, reason: `${id} sha256 未配置` }
  const actual = createHash("sha256").update(readFileSync(executable)).digest("hex")
  if (actual !== entry.sha256.toLowerCase()) return { available: false, reason: `${id} sha256 校验失败` }
  return { available: true, path: executable, entry }
}
