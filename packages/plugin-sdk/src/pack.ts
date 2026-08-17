/**
 * `.cpxplugin` 打包工具（插件作者侧；PR 9 开发工具）。
 *
 * 包格式与宿主安装校验（apps/agent PluginInstaller）保持一致：
 * - 包根包含 manifest.json，manifest.files 是包内相对路径 → sha256 清单，
 *   且必须与实际文件集合精确一致（manifest.json 自身哈希自指不参与匹配）；
 * - ZIP 只使用 store/deflate，路径使用 `/` 分隔，拒绝符号链接；
 * - 上限与宿主一致：5000 个文件、单文件 64 MiB、总大小 256 MiB。
 *
 * pack 会按实际文件自动重写 manifest.files（保留其余字段），
 * 因此作者无需手算哈希。输出 digest 与安装后的包 digest 一致，
 * 可用于核对信任确认。
 */

import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { PluginSdkError } from "./errors"
import { validateManifest, type PluginManifestV1 } from "./manifest"
import { canonicalDigest } from "./wire/codec"

export const PLUGIN_PACK_MAX_FILES = 5_000
export const PLUGIN_PACK_MAX_TOTAL_BYTES = 256 * 1024 * 1024

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex")

// ── ZIP writer（store 方法，无压缩依赖） ────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    }
    table[n] = value >>> 0
  }
  return table
})()

const crc32 = (data: Buffer): number => {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xFF]! ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const LOCAL_HEADER_SIGNATURE = 0x04034B50
const CENTRAL_SIGNATURE = 0x02014B50
const EOCD_SIGNATURE = 0x06054B50
const UTF8_FLAG = 0x800

interface ZipEntry {
  path: string
  data: Buffer
}

const buildZip = (entries: ZipEntry[]): Buffer => {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8")
    const checksum = crc32(entry.data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(UTF8_FLAG, 6)
    header.writeUInt16LE(0, 8) // method: store
    header.writeUInt16LE(0, 10) // mod time
    header.writeUInt16LE(0, 12) // mod date
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(entry.data.length, 18)
    header.writeUInt32LE(entry.data.length, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28) // extra length
    chunks.push(header, name, entry.data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(0, 10) // method
    centralHeader.writeUInt16LE(0, 12) // mod time
    centralHeader.writeUInt16LE(0, 14) // mod date
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(entry.data.length, 20)
    centralHeader.writeUInt32LE(entry.data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra length
    centralHeader.writeUInt16LE(0, 32) // comment length
    centralHeader.writeUInt16LE(0, 34) // disk number start
    centralHeader.writeUInt16LE(0, 36) // internal attributes
    centralHeader.writeUInt32LE(0, 38) // external attributes
    centralHeader.writeUInt32LE(offset, 42)
    central.push(centralHeader, name)
    offset += 30 + name.length + entry.data.length
  }
  const centralData = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralData.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralData, eocd])
}

// ── 目录收集（与宿主安装侧边界一致） ────────────────────────────────────

interface CollectedFile {
  path: string
  sha256: string
  data: Buffer
}

const collectDirectoryFiles = async (root: string): Promise<CollectedFile[]> => {
  const entries: CollectedFile[] = []
  let totalBytes = 0
  const walk = async (directory: string) => {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const absolute = join(directory, child.name)
      if (child.isSymbolicLink()) {
        throw new PluginSdkError({ code: "INVALID_FILE_PATH", message: "插件目录不允许包含符号链接" })
      }
      if (child.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!child.isFile()) continue
      if (entries.length >= PLUGIN_PACK_MAX_FILES) {
        throw new PluginSdkError({ code: "PACK_LIMIT", message: `插件文件数超过上限 ${PLUGIN_PACK_MAX_FILES}` })
      }
      const data = await readFile(absolute)
      totalBytes += data.length
      if (totalBytes > PLUGIN_PACK_MAX_TOTAL_BYTES) {
        throw new PluginSdkError({ code: "PACK_LIMIT", message: `插件总大小超过 ${PLUGIN_PACK_MAX_TOTAL_BYTES} 字节上限` })
      }
      entries.push({ path: relative(root, absolute).replaceAll("\\", "/"), sha256: sha256(data), data })
    }
  }
  await walk(root)
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return entries
}

export interface PackPluginOptions {
  /** 插件源码目录（含 manifest.json）。 */
  directory: string
  /** 输出 .cpxplugin 路径；默认 <上级目录>/<id>@<version>.cpxplugin。 */
  outputPath?: string
}

export interface PackPluginResult {
  outputPath: string
  /** 与宿主安装后一致的包 digest（canonical）。 */
  digest: string
  /** 打包后（files 已补全）的 manifest。 */
  manifest: PluginManifestV1
  fileCount: number
}

/** 打包插件目录为 .cpxplugin（自动补全 manifest.files 哈希）。 */
export async function packPluginDirectory(options: PackPluginOptions): Promise<PackPluginResult> {
  const directory = resolve(options.directory)
  const initial = await collectDirectoryFiles(directory)
  if (!initial.some((entry) => entry.path === "manifest.json")) {
    throw new PluginSdkError({ code: "INVALID_MANIFEST", message: "插件包缺少 manifest.json" })
  }
  const manifestJson = await readFile(join(directory, "manifest.json"), "utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestJson)
  } catch {
    throw new PluginSdkError({ code: "INVALID_MANIFEST", message: "manifest.json 不是合法 JSON" })
  }
  const validated = validateManifest(parsed)
  if (!validated.ok) {
    const codes = validated.errors.map((item) => item.code).slice(0, 5)
    throw new PluginSdkError({ code: "INVALID_MANIFEST", message: `manifest.json 校验失败（${codes.join(",")}）` })
  }
  const manifest = validated.manifest
  // 按实际文件补全 manifest.files。manifest.json 自身哈希自指无法成立，
  // 宿主安装时跳过该条目的哈希匹配；这里写入格式合法的占位以通过
  // manifest 校验（digest 计算仍使用重写后文件的实际哈希）。
  const files: Record<string, string> = {}
  for (const entry of initial) {
    files[entry.path] = entry.path === "manifest.json" ? "0".repeat(64) : entry.sha256
  }
  const rewritten = { ...manifest, files }
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(rewritten, null, 2)}\n`, "utf8")
  const final = await collectDirectoryFiles(directory)
  // 与宿主 PluginInstaller.computePluginDigest 完全一致：files 含 manifest.json
  // 的实际哈希（其值不参与哈希匹配，但必须参与清单与 digest）。
  const digest = canonicalDigest({
    manifest: rewritten,
    files: final.map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
  })
  const outputPath = resolve(options.outputPath ?? join(dirname(directory), `${manifest.id}@${manifest.version}.cpxplugin`))
  await mkdir(dirname(outputPath), { recursive: true })
  await new Promise<void>((resolveWrite, rejectWrite) => {
    const stream = createWriteStream(outputPath)
    stream.on("error", rejectWrite)
    stream.on("finish", () => resolveWrite())
    stream.end(buildZip(final))
  })
  return { outputPath, digest, manifest: rewritten, fileCount: final.length }
}
