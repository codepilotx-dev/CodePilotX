/**
 * CodePilotX 插件开发 CLI（PR 9 开发工具）。
 *
 * 用法（在 packages/plugin-sdk 下）：
 *   bun run plugin validate <manifest.json>
 *   bun run plugin pack <directory> [-o <output.cpxplugin>]
 *   bun run plugin conformance:runner <executable> [args...]
 *       --plugin-id <id> --generation <g> [--token <instanceToken>]
 *   bun run plugin conformance:persistence <provider.ts> [--dataRoot <dir>]
 *
 * 输出只包含安全错误码与相对路径，不打印凭据、环境变量或绝对路径；
 * 失败时退出码为 1。conformance:persistence 仅用于插件作者对自身
 * provider 的本地开发验证；宿主运行时加载仍然只走 SystemProfileLoader。
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { PluginSdkError } from "../src/errors"
import { validateManifest } from "../src/manifest"
import { packPluginDirectory } from "../src/pack"
import { runRunnerConformance } from "../src/testing/runner-conformance"
import {
  runSessionPersistenceConformance,
  type SessionPersistenceProvider,
} from "../src/testing/session-persistence-conformance"

const cwd = process.cwd()
const safePath = (path: string) => {
  const rel = relative(cwd, resolve(path))
  return rel && !rel.startsWith("..") ? rel : "<外部路径>"
}

const fail = (code: string, message: string): never => {
  console.error(`错误 [${code}]：${message}`)
  process.exit(1)
  throw new Error("unreachable")
}

const readManifest = async (manifestPath: string) => {
  let text: string
  try {
    text = await Bun.file(manifestPath).text()
  } catch {
    return fail("INVALID_MANIFEST", "无法读取 manifest.json")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail("INVALID_MANIFEST", "manifest.json 不是合法 JSON")
  }
  return validateManifest(parsed)
}

const commandValidate = async (manifestPath: string) => {
  const result = await readManifest(manifestPath)
  if (!result.ok) {
    const codes = result.errors.map((item) => item.code).slice(0, 10).join(", ")
    return fail("INVALID_MANIFEST", `manifest 校验失败：${codes}`)
  }
  console.log(`✓ 合法：${result.manifest.id}@${result.manifest.version}（tier=${result.manifest.tier}）`)
}

const commandPack = async (directory: string, outputPath: string | undefined) => {
  try {
    const result = await packPluginDirectory({ directory, ...(outputPath ? { outputPath } : {}) })
    console.log(`✓ 已打包：${safePath(result.outputPath)}`)
    console.log(`  digest：${result.digest}`)
    console.log(`  文件数：${result.fileCount}`)
  } catch (cause) {
    if (cause instanceof PluginSdkError) fail(cause.code, cause.message)
    fail("PACK_FAILED", "打包失败（内部错误）")
  }
}

const commandRunnerConformance = async (executable: string, args: string[], flags: Record<string, string | undefined>) => {
  const pluginId = flags["plugin-id"]
  const generation = flags["generation"]
  if (!pluginId || !generation) return fail("INVALID_ARGS", "conformance:runner 需要 --plugin-id 与 --generation")
  const report = await runRunnerConformance({
    executable,
    args,
    pluginId,
    generation,
    ...(flags["token"] ? { instanceToken: flags["token"] } : {}),
    ...(flags["timeout"] ? { timeoutMs: Number(flags["timeout"]) } : {}),
  })
  for (const check of report.checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}${check.detail ? `：${check.detail}` : ""}`)
  }
  if (!report.pass) process.exit(1)
  console.log("✓ runner conformance 全部通过")
}

const commandPersistenceConformance = async (providerScript: string, dataRoot: string | undefined) => {
  let providerModule: Record<string, unknown>
  try {
    providerModule = await import(pathToFileURL(resolve(providerScript)).href) as Record<string, unknown>
  } catch {
    return fail("PROVIDER_LOAD_FAILED", "无法加载 provider 脚本（请确认路径与语法）")
  }
  const provider = (providerModule.default ?? providerModule.provider) as SessionPersistenceProvider | undefined
  if (!provider || typeof provider !== "object") {
    return fail("PROVIDER_LOAD_FAILED", "provider 脚本必须 default export（或命名导出 provider）一个 SessionPersistenceProvider 对象")
  }
  const ownsRoot = dataRoot === undefined
  const root = dataRoot ? resolve(dataRoot) : await mkdtemp(join(tmpdir(), "cpx-persistence-conformance-"))
  try {
    const report = await runSessionPersistenceConformance(provider, {
      dataRoot: root,
      probe: async (probeRoot) => {
        const entries = await Bun.$`ls ${probeRoot}`.text().catch(() => "")
        return entries.trim().length > 0
      },
    })
    if (!report.pass) {
      for (const failure of report.failures) console.error(`✗ ${failure}`)
      process.exit(1)
    }
    console.log(`✓ session-persistence conformance 全部通过（dataRoot：${safePath(root)}）`)
  } finally {
    if (ownsRoot) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}

const main = async () => {
  const [command, ...rest] = process.argv.slice(2)
  const flags: Record<string, string | undefined> = {}
  const positionals: string[] = []
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!
    if (arg === "-o" || arg === "--output") {
      flags["output"] = rest[++index]
    } else if (arg.startsWith("--")) {
      const separator = arg.indexOf("=")
      if (separator > 0) {
        flags[arg.slice(2, separator)] = arg.slice(separator + 1)
      } else {
        flags[arg.slice(2)] = rest[++index]
      }
    } else {
      positionals.push(arg)
    }
  }
  switch (command) {
    case "validate": {
      const manifestPath = positionals[0]
      if (!manifestPath) return fail("INVALID_ARGS", "validate 需要 manifest.json 路径")
      await commandValidate(manifestPath)
      break
    }
    case "pack": {
      const directory = positionals[0]
      if (!directory) return fail("INVALID_ARGS", "pack 需要插件目录")
      await commandPack(directory, flags["output"])
      break
    }
    case "conformance:runner": {
      const executable = positionals[0]
      if (!executable) return fail("INVALID_ARGS", "conformance:runner 需要插件进程入口")
      await commandRunnerConformance(executable, positionals.slice(1), flags)
      break
    }
    case "conformance:persistence": {
      const providerScript = positionals[0]
      if (!providerScript) return fail("INVALID_ARGS", "conformance:persistence 需要 provider 脚本路径")
      await commandPersistenceConformance(providerScript, flags["dataRoot"])
      break
    }
    default:
      return fail("INVALID_ARGS", `未知命令：${command ?? "<空>"}。支持 validate/pack/conformance:runner/conformance:persistence`)
  }
}

await main()
