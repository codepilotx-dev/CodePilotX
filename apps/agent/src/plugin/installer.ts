/**
 * .cpxplugin 安装器与开发目录链接。
 *
 * 安全模型：
 * - 同卷 staging + 原子 rename；任何校验失败都不改变 active package。
 * - ZIP entry 必须通过路径规范化、Windows device name/ADS、symlink、
 *   重复路径、大小写折叠冲突、文件数/单文件/总大小上限检查。
 * - 安装绝不执行 install/postinstall/prepare 或任何插件代码；
 *   只校验 manifest hash 与每文件 hash。
 * - 安装完成状态只能是 installed-disabled；digest 变化重置 enablement。
 * - 开发目录链接只记录 canonical path 与目录 digest；文件变化产生
 *   staged digest，不自动执行。
 * - 卸载删除包文件，但保留插件数据目录（data/<pluginId>）、KV 与配置。
 */

import { createHash, randomUUID } from "node:crypto"
import { createReadStream, readFileSync } from "node:fs"
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import extractZip from "extract-zip"
import {
  canonicalDigest,
  validateManifest,
  type PluginManifestV1,
} from "@codepilotx/plugin-sdk"
import { PluginRepository } from "../storage/repositories/plugin-repository"
import type { AgentDatabase } from "../storage/database/AgentDatabase"

export type PluginInstallErrorCode =
  | "PLUGIN_ARCHIVE_UNSAFE"
  | "PLUGIN_ARCHIVE_INVALID"
  | "PLUGIN_ARCHIVE_LIMIT"
  | "PLUGIN_MANIFEST_INVALID"
  | "PLUGIN_HASH_MISMATCH"
  | "PLUGIN_LINK_INVALID"
  | "PLUGIN_INSTALL_FAILED"
  | "PLUGIN_NOT_FOUND"

export class PluginInstallError extends Error {
  constructor(readonly code: PluginInstallErrorCode, message: string) {
    super(message)
    this.name = "PluginInstallError"
  }
}

export interface InstalledPluginRecord {
  pluginId: string
  version: string
  digest: string
  source: "package" | "linked-directory"
  installedPath: string
}

// ── 上限（与 Manifest 校验一致的安全边界） ──────────────────────────────

export const PLUGIN_MAX_FILES = 5_000
export const PLUGIN_MAX_FILE_BYTES = 64 * 1024 * 1024
export const PLUGIN_MAX_TOTAL_BYTES = 256 * 1024 * 1024
export const PLUGIN_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024

const WINDOWS_DEVICE_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
])

/** yauzl 路径安全类错误提示（与我们的 entry 校验重叠时归一化错误码）。 */
const PATH_SAFETY_HINT = /path|\.\.|absolute|characters|backslash|invalid name|traversal/i

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50

interface CentralDirectoryEntry {
  name: string
  method: number
  flags: number
  uncompressedSize: number
  externalFileAttributes: number
}

/**
 * 解压前预扫描 ZIP central directory（只读原始 entry 名）。
 *
 * yauzl 会把 `\` 归一化为 `/`，onEntry 看不到原始名字；因此所有
 * 路径安全检查必须在解压前基于原始 entry 名完成。只支持 store/deflate，
 * 拒绝加密与 ZIP64（无法校验内容或过于复杂）。
 */
export const scanZipCentralDirectory = (buffer: Buffer): CentralDirectoryEntry[] => {
  // ZIP64 EOCD 定位器（签名 0x07064b50）存在即拒绝。
  const zip64LocatorSignature = 0x07064b50
  for (let i = buffer.length - 4; i >= Math.max(0, buffer.length - 128); i -= 1) {
    if (buffer.readUInt32LE(i) === zip64LocatorSignature) {
      throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "不支持 ZIP64 归档")
    }
  }
  let eocdOffset = -1
  const minSearch = Math.max(0, buffer.length - 65_557)
  for (let i = buffer.length - 22; i >= minSearch; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "ZIP 缺少 EOCD")
  if (buffer.readUInt32LE(eocdOffset + 4) === ZIP64_EOCD_SIGNATURE) {
    throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "不支持 ZIP64 归档")
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const cdSize = buffer.readUInt32LE(eocdOffset + 12)
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (cdOffset + cdSize > buffer.length) throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "ZIP central directory 越界")
  const entries: CentralDirectoryEntry[] = []
  let offset = cdOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "ZIP central directory 损坏")
    }
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const externalFileAttributes = buffer.readUInt32LE(offset + 38)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8")
    entries.push({ name, method, flags, uncompressedSize, externalFileAttributes })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const normalizeEntryName = (fileName: string): string | null => {
  if (fileName.length === 0 || fileName.length > 512) return null
  if (fileName.includes("\\")) return null // 统一要求 / 分隔
  if (fileName.startsWith("/")) return null
  if (/^[A-Za-z]:/.test(fileName)) return null // 盘符
  if (fileName.includes(":")) return null // ADS / 盘符冒号
  if (/[\x00-\x1f\x7f]/.test(fileName)) return null // 控制字符
  const parts = fileName.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null
  const leaf = parts[parts.length - 1]!
  const deviceName = leaf.split(".")[0]!.toUpperCase()
  if (WINDOWS_DEVICE_NAMES.has(deviceName)) return null
  return parts.join("/")
}

interface ZipScanState {
  seen: Set<string>
  seenFold: Set<string>
  fileCount: number
  totalBytes: number
}

/** 逐 entry 校验：非法路径/symlink/重复/大小写折叠冲突/大小上限。 */
const assertSafeZipEntry = (
  state: ZipScanState,
  fileName: string,
  externalFileAttributes: number,
  uncompressedSize: number,
): string => {
  const normalized = normalizeEntryName(fileName)
  if (!normalized) {
    throw new PluginInstallError("PLUGIN_ARCHIVE_UNSAFE", "ZIP 包含不安全路径")
  }
  const unixType = (externalFileAttributes >> 16) & 0xF000
  if (unixType === 0xA000) {
    throw new PluginInstallError("PLUGIN_ARCHIVE_UNSAFE", "ZIP 包含符号链接")
  }
  const isDirectory = normalized.endsWith("/") || unixType === 0x4000
  if (state.seen.has(normalized)) {
    throw new PluginInstallError("PLUGIN_ARCHIVE_UNSAFE", "ZIP 包含重复路径")
  }
  // Windows 大小写折叠冲突：FOO.txt 与 foo.txt 指向同一文件。
  const folded = normalized.toLocaleUpperCase("en-US")
  if (state.seenFold.has(folded)) {
    throw new PluginInstallError("PLUGIN_ARCHIVE_UNSAFE", "ZIP 包含大小写折叠冲突路径")
  }
  if (!isDirectory) {
    state.fileCount += 1
    if (state.fileCount > PLUGIN_MAX_FILES) {
      throw new PluginInstallError("PLUGIN_ARCHIVE_LIMIT", `ZIP 文件数超过上限 ${PLUGIN_MAX_FILES}`)
    }
    if (uncompressedSize > PLUGIN_MAX_FILE_BYTES) {
      throw new PluginInstallError("PLUGIN_ARCHIVE_LIMIT", `单个文件超过 ${PLUGIN_MAX_FILE_BYTES} 字节上限`)
    }
    state.totalBytes += uncompressedSize
    if (state.totalBytes > PLUGIN_MAX_TOTAL_BYTES) {
      throw new PluginInstallError("PLUGIN_ARCHIVE_LIMIT", `解压总大小超过 ${PLUGIN_MAX_TOTAL_BYTES} 字节上限`)
    }
  }
  state.seen.add(normalized)
  state.seenFold.add(folded)
  return normalized
}

const fileSha256 = async (path: string) => {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

/** 递归收集目录内文件（相对路径 / 分隔，排序），受文件数与总大小约束。 */
export const collectDirectoryFiles = async (root: string, maxFiles: number, maxTotalBytes: number): Promise<Array<{ path: string; sha256: string }>> => {
  const entries: Array<{ path: string; sha256: string }> = []
  let totalBytes = 0
  const walk = async (directory: string) => {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const absolute = join(directory, child.name)
      if (child.isSymbolicLink()) {
        throw new PluginInstallError("PLUGIN_LINK_INVALID", "插件目录不允许包含符号链接")
      }
      if (child.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!child.isFile()) continue
      if (entries.length >= maxFiles) {
        throw new PluginInstallError("PLUGIN_ARCHIVE_LIMIT", `插件文件数超过上限 ${maxFiles}`)
      }
      const metadata = await stat(absolute)
      totalBytes += metadata.size
      if (totalBytes > maxTotalBytes) {
        throw new PluginInstallError("PLUGIN_ARCHIVE_LIMIT", `插件总大小超过 ${maxTotalBytes} 字节上限`)
      }
      entries.push({ path: relative(root, absolute).replaceAll("\\", "/"), sha256: await fileSha256(absolute) })
    }
  }
  await walk(root)
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return entries
}

/** 包 digest：manifest 与文件清单的 canonical 摘要（与 key 顺序无关）。 */
export const computePluginDigest = (manifest: PluginManifestV1, files: ReadonlyArray<{ path: string; sha256: string }>) =>
  canonicalDigest({
    manifest,
    files: files.map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
  })

const loadAndValidateManifest = async (directory: string): Promise<{ manifest: PluginManifestV1; manifestJson: string }> => {
  let manifestJson: string
  try {
    manifestJson = await readFile(join(directory, "manifest.json"), "utf8")
  } catch {
    throw new PluginInstallError("PLUGIN_MANIFEST_INVALID", "插件包缺少 manifest.json")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestJson)
  } catch {
    throw new PluginInstallError("PLUGIN_MANIFEST_INVALID", "manifest.json 不是合法 JSON")
  }
  const result = validateManifest(parsed)
  if (!result.ok) {
    const codes = result.errors.map((item) => item.code).slice(0, 5)
    throw new PluginInstallError("PLUGIN_MANIFEST_INVALID", `manifest.json 校验失败（${codes.join(",")}）`)
  }
  return { manifest: result.manifest, manifestJson }
}

/** 是否位于包根内（含相等）。 */
const containedInRoot = (root: string, candidate: string) => {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

export class PluginInstaller {
  private readonly repo: PluginRepository

  constructor(
    private readonly options: {
      /** <dataRoot>/plugins */
      root: string
      db: AgentDatabase
    },
  ) {
    this.repo = new PluginRepository(options.db)
  }

  packagesRoot() { return join(this.options.root, "packages") }
  dataRoot() { return join(this.options.root, "data") }
  stagingRoot() { return join(this.options.root, ".staging") }

  /** 安装 .cpxplugin：校验 → staging → 原子 rename → DB 记录（installed-disabled）。 */
  async installPackage(zipPath: string): Promise<InstalledPluginRecord> {
    const archiveStat = await stat(zipPath).catch(() => null)
    if (!archiveStat?.isFile()) throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "插件包文件不存在")
    if (archiveStat.size > PLUGIN_MAX_ARCHIVE_BYTES) {
      throw new PluginInstallError("PLUGIN_ARCHIVE_LIMIT", `插件包超过 ${PLUGIN_MAX_ARCHIVE_BYTES} 字节上限`)
    }
    await mkdir(this.packagesRoot(), { recursive: true })
    await mkdir(this.stagingRoot(), { recursive: true })
    const staging = join(this.stagingRoot(), randomUUID())
    await mkdir(staging, { recursive: true })
    try {
      // 解压前预扫描：基于原始 entry 名做全部路径安全检查（yauzl 会
      // 归一化反斜杠，onEntry 看不到原始名字）。
      const archiveBuffer = await readFile(zipPath)
      const state: ZipScanState = { seen: new Set(), seenFold: new Set(), fileCount: 0, totalBytes: 0 }
      const entries = scanZipCentralDirectory(archiveBuffer)
      for (const entry of entries) {
        if ((entry.flags & 0x1) !== 0) {
          throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "不支持加密 ZIP")
        }
        if (entry.method !== 0 && entry.method !== 8) {
          throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", `不支持的压缩方法 ${entry.method}`)
        }
        assertSafeZipEntry(state, entry.name, entry.externalFileAttributes, entry.uncompressedSize)
      }
      // 第二道防线：解压时逐 entry 复核（normalize 后的名字，独立 state）。
      try {
        const extractState: ZipScanState = { seen: new Set(), seenFold: new Set(), fileCount: 0, totalBytes: 0 }
        await extractZip(zipPath, {
          dir: staging,
          onEntry: (extracted) => {
            assertSafeZipEntry(extractState, extracted.fileName, extracted.externalFileAttributes, extracted.uncompressedSize)
          },
        })
      } catch (cause) {
        if (cause instanceof PluginInstallError) throw cause
        // yauzl 会在 onEntry 前拒绝绝对路径/../等（与我们的校验重叠）。
        const message = cause instanceof Error ? cause.message : String(cause)
        if (PATH_SAFETY_HINT.test(message)) {
          throw new PluginInstallError("PLUGIN_ARCHIVE_UNSAFE", "ZIP 包含不安全路径")
        }
        throw new PluginInstallError("PLUGIN_ARCHIVE_INVALID", "ZIP 格式非法或不受支持")
      }
      const { manifest, manifestJson } = await loadAndValidateManifest(staging)
      // manifest.json 必须自包含在 files 清单中（其自身由解析校验，
      // hash 自指无法成立，因此不参与哈希匹配）。
      if (!manifest.files["manifest.json"]) {
        throw new PluginInstallError("PLUGIN_MANIFEST_INVALID", "manifest.files 必须包含 manifest.json")
      }
      const files = await collectDirectoryFiles(staging, PLUGIN_MAX_FILES, PLUGIN_MAX_TOTAL_BYTES)
      // 文件集合必须与 manifest.files 精确一致。
      const expected = Object.keys(manifest.files).sort()
      const actual = files.map((entry) => entry.path).sort()
      if (expected.length !== actual.length || expected.some((path, index) => path !== actual[index])) {
        throw new PluginInstallError("PLUGIN_HASH_MISMATCH", "包内文件集合与 manifest.files 不一致")
      }
      for (const entry of files) {
        if (entry.path === "manifest.json") continue
        if (entry.sha256 !== manifest.files[entry.path]) {
          throw new PluginInstallError("PLUGIN_HASH_MISMATCH", `文件 ${entry.path} 哈希不一致`)
        }
      }
      const digest = computePluginDigest(manifest, files)
      const target = join(this.packagesRoot(), `${manifest.id}@${manifest.version}-${digest.slice(0, 12)}`)
      await rm(target, { recursive: true, force: true }).catch(() => undefined)
      await rename(staging, target)
      try {
        return await this.commitPackage(manifest, manifestJson, digest, "package", target, null)
      } catch (cause) {
        // DB 提交失败：回滚新目录，保持旧 active 不变。
        await rm(target, { recursive: true, force: true }).catch(() => undefined)
        throw cause
      }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** 链接开发目录：只记录 canonical path 与目录 digest，不复制文件。 */
  async linkDirectory(directoryPath: string): Promise<InstalledPluginRecord> {
    const metadata = await lstat(directoryPath).catch(() => null)
    if (!metadata?.isDirectory()) throw new PluginInstallError("PLUGIN_LINK_INVALID", "开发目录不存在或不是目录")
    const canonical = await realpath(directoryPath).catch(() => resolve(directoryPath))
    // 禁止链接插件管理目录自身或其子目录（packages/data/.staging）。
    if (resolve(canonical) === resolve(this.options.root)
      || containedInRoot(this.packagesRoot(), canonical)
      || containedInRoot(this.dataRoot(), canonical)
      || containedInRoot(this.stagingRoot(), canonical)) {
      throw new PluginInstallError("PLUGIN_LINK_INVALID", "不能链接插件管理目录自身")
    }
    const { manifest, manifestJson } = await loadAndValidateManifest(canonical)
    const files = await collectDirectoryFiles(canonical, PLUGIN_MAX_FILES, PLUGIN_MAX_TOTAL_BYTES)
    const digest = computePluginDigest(manifest, files)
    // 开发目录不要求 hash 与 manifest.files 精确一致（文件正在迭代）。
    return this.commitPackage(manifest, manifestJson, digest, "linked-directory", canonical, digest)
  }

  /** 重算开发目录 digest；变化写入 staged，不自动执行。 */
  async rescanLinkedDirectories(): Promise<Array<{ pluginId: string; changed: boolean; stagedDigest: string | null }>> {
    const results: Array<{ pluginId: string; changed: boolean; stagedDigest: string | null }> = []
    for (const plugin of this.repo.listPackages()) {
      if (plugin.source !== "linked-directory" || !plugin.linkedPath) continue
      try {
        const metadata = await lstat(plugin.linkedPath).catch(() => null)
        if (!metadata?.isDirectory()) {
          this.repo.setStagedDirectoryDigest(plugin.pluginId, null)
          results.push({ pluginId: plugin.pluginId, changed: true, stagedDigest: null })
          continue
        }
        const files = await collectDirectoryFiles(plugin.linkedPath, PLUGIN_MAX_FILES, PLUGIN_MAX_TOTAL_BYTES)
        const manifest = (await loadAndValidateManifest(plugin.linkedPath)).manifest
        const digest = computePluginDigest(manifest, files)
        if (digest !== plugin.directoryDigest) {
          this.repo.setStagedDirectoryDigest(plugin.pluginId, digest)
          results.push({ pluginId: plugin.pluginId, changed: true, stagedDigest: digest })
        } else {
          this.repo.setStagedDirectoryDigest(plugin.pluginId, null)
          results.push({ pluginId: plugin.pluginId, changed: false, stagedDigest: null })
        }
      } catch {
        this.repo.setStagedDirectoryDigest(plugin.pluginId, null)
        results.push({ pluginId: plugin.pluginId, changed: true, stagedDigest: null })
      }
    }
    return results
  }

  /** 卸载：删除包文件与激活/授权记录；保留数据目录、KV 与配置。 */
  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.repo.getPackage(pluginId)
    if (!plugin) throw new PluginInstallError("PLUGIN_NOT_FOUND", "插件未安装")
    this.repo.removePackage(pluginId)
    // 只删除包目录（必须位于 packagesRoot 内）。
    if (containedInRoot(this.packagesRoot(), plugin.installedPath) && plugin.installedPath !== this.packagesRoot()) {
      await rm(resolve(plugin.installedPath), { recursive: true, force: true }).catch(() => undefined)
    }
    // data/<pluginId> 数据目录保留。
  }

  private async commitPackage(
    manifest: PluginManifestV1,
    manifestJson: string,
    digest: string,
    source: "package" | "linked-directory",
    installedPath: string,
    directoryDigest: string | null,
  ): Promise<InstalledPluginRecord> {
    const previous = this.repo.getPackage(manifest.id)
    this.repo.upsertPackage({
      pluginId: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      publisher: manifest.publisher,
      tier: manifest.tier,
      manifestJson,
      digest,
      source,
      linkedPath: source === "linked-directory" ? installedPath : null,
      directoryDigest,
      stagedDirectoryDigest: null,
      installedPath,
    })
    // 安装/更新后必须处于 installed-disabled；digest 变化重置 enablement。
    this.repo.resetActivation(manifest.id)
    await mkdir(join(this.dataRoot(), manifest.id), { recursive: true }).catch(() => undefined)
    // 更新后清理旧包目录（DB 已指向新目录）。
    if (previous && previous.installedPath !== installedPath && previous.source === "package") {
      await rm(previous.installedPath, { recursive: true, force: true }).catch(() => undefined)
    }
    return { pluginId: manifest.id, version: manifest.version, digest, source, installedPath }
  }
}

// 保留同步 hash 工具供测试与诊断使用。
export const hashFileSha256 = (path: string) => {
  const hash = createHash("sha256")
  hash.update(readFileSync(path))
  return hash.digest("hex")
}
