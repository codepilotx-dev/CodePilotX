import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  SRT_MAX_CONCURRENT_COMMANDS,
  SRT_PROXY_PORT_RANGE,
  SRT_RUNTIME_VERSION,
  SRT_WINDOWS_HELPER_SHA256,
  type SrtWindowsArchitecture,
} from "../apps/agent/src/sandbox/SandboxRuntimeManifest"

interface PackageManifest {
  version?: unknown
  dependencies?: Record<string, unknown>
}

export interface VerifiedSrtRuntimeManifest {
  runtimeVersion: string
  proxyPortRange: readonly [number, number]
  maxConcurrentCommands: number
  helperSha256: typeof SRT_WINDOWS_HELPER_SHA256
}

const SRT_PACKAGE = "@anthropic-ai/sandbox-runtime"

const readJson = async (path: string): Promise<PackageManifest> =>
  JSON.parse(await readFile(path, "utf8")) as PackageManifest

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

export async function assertSrtHelperFile(
  path: string,
  architecture: SrtWindowsArchitecture,
): Promise<void> {
  const actual = await sha256File(path)
  const expected = SRT_WINDOWS_HELPER_SHA256[architecture]
  if (actual !== expected) {
    throw new Error(
      `SRT Windows ${architecture} helper SHA-256 不匹配：expected=${expected} actual=${actual}`,
    )
  }
}

export async function verifySrtRuntimeManifest(
  workspaceRoot = resolve(import.meta.dir, ".."),
): Promise<VerifiedSrtRuntimeManifest> {
  const agentRoot = resolve(workspaceRoot, "apps/agent")
  const agentPackage = await readJson(resolve(agentRoot, "package.json"))
  const declaredVersion = agentPackage.dependencies?.[SRT_PACKAGE]
  if (declaredVersion !== SRT_RUNTIME_VERSION) {
    throw new Error(
      `${SRT_PACKAGE} 必须精确固定为 ${SRT_RUNTIME_VERSION}，当前声明为 ${String(declaredVersion)}`,
    )
  }

  const installedRoot = resolve(agentRoot, "node_modules", SRT_PACKAGE)
  const installedPackage = await readJson(resolve(installedRoot, "package.json"))
  if (installedPackage.version !== SRT_RUNTIME_VERSION) {
    throw new Error(
      `${SRT_PACKAGE} 实际解析版本必须为 ${SRT_RUNTIME_VERSION}，当前为 ${String(installedPackage.version)}`,
    )
  }

  const [firstPort, lastPort] = SRT_PROXY_PORT_RANGE
  const portCount = lastPort - firstPort + 1
  if (
    !Number.isInteger(firstPort)
    || !Number.isInteger(lastPort)
    || firstPort < 1
    || lastPort > 65_535
    || portCount !== SRT_MAX_CONCURRENT_COMMANDS * 2
  ) {
    throw new Error(
      `SRT WFP 端口范围必须为每条并发命令保留两个端口：range=${firstPort}-${lastPort} concurrency=${SRT_MAX_CONCURRENT_COMMANDS}`,
    )
  }

  for (const architecture of Object.keys(SRT_WINDOWS_HELPER_SHA256) as SrtWindowsArchitecture[]) {
    await assertSrtHelperFile(
      resolve(installedRoot, "vendor/srt-win", architecture, "srt-win.exe"),
      architecture,
    )
  }

  return {
    runtimeVersion: SRT_RUNTIME_VERSION,
    proxyPortRange: SRT_PROXY_PORT_RANGE,
    maxConcurrentCommands: SRT_MAX_CONCURRENT_COMMANDS,
    helperSha256: SRT_WINDOWS_HELPER_SHA256,
  }
}

if (import.meta.main) {
  const verified = await verifySrtRuntimeManifest()
  console.log(
    `[CodePilotX] SRT ${verified.runtimeVersion} manifest verified (${verified.maxConcurrentCommands} concurrent commands, ports ${verified.proxyPortRange.join("-")})`,
  )
}
