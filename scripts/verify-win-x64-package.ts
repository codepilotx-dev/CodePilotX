import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { spawn, type ChildProcess } from "node:child_process"
import { assertAgentBinaryHasNoStaticRiskFeatures } from "./agent-pe-signatures"
import { assertWindowsX64PE } from "./windows-pe"

const root = resolve(import.meta.dir, "..")
const verifierCapabilities = [
  "rpc.typed.v1",
  "model.catalog.paged.v1",
  "provider.config.pi.v1",
] as const
const requireSigning = process.argv.includes("--require-signing")
const unpackedArgument = process.argv.find(argument => argument.startsWith("--unpacked="))
const unpacked = unpackedArgument
  ? resolve(unpackedArgument.slice("--unpacked=".length))
  : resolve(root, "release/win-unpacked")

const application = join(unpacked, "CodePilotX.exe")
const agent = join(unpacked, "resources/agent/codepilotx-agent.exe")
const requiredFiles = [
  application,
  agent,
  join(unpacked, "resources/app.asar"),
  join(unpacked, "resources/renderer/index.html"),
  join(unpacked, "resources/THIRD_PARTY_NOTICES.md"),
]
for (const path of requiredFiles) {
  if (!existsSync(path)) throw new Error(`Windows x64 包缺少文件：${path}`)
  if ((await stat(path)).size === 0) throw new Error(`Windows x64 包含空文件：${path}`)
}
const thirdPartyDirectory = join(unpacked, "resources/third_party")
if (!existsSync(thirdPartyDirectory) || !(await stat(thirdPartyDirectory)).isDirectory()) {
  throw new Error(`Windows x64 包缺少第三方许可证目录：${thirdPartyDirectory}`)
}
for (const path of [application, agent]) {
  await assertWindowsX64PE(path)
}
await assertAgentBinaryHasNoStaticRiskFeatures(agent)
await assertPackagedPiCatalog(agent)

const releaseDirectory = resolve(root, "release")
const artifacts = await readdir(releaseDirectory)
const installerPaths = artifacts
  .filter(name => /^CodePilotX-.*-x64\.exe$/i.test(name))
  .map(name => resolve(releaseDirectory, name))
const installers = await Promise.all(installerPaths.map(async path => ({
  path,
  modifiedAt: (await stat(path)).mtimeMs,
})))
const installer = installers.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.path
if (!installer) throw new Error("未找到 x64 NSIS 安装器")

if (requireSigning) {
  await assertAuthenticodeValid([application, agent, installer])
}

console.log(`[CodePilotX] Windows x64 package verified: ${unpacked}`)
console.log(`[CodePilotX] Installer: ${installer}`)
console.log(`[CodePilotX] Installer size: ${(await stat(installer)).size} bytes`)
console.log(`[CodePilotX] Installer SHA-256: ${await sha256(installer)}`)

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path)
    stream.on("data", chunk => hash.update(chunk))
    stream.once("error", rejectHash)
    stream.once("end", resolveHash)
  })
  return hash.digest("hex")
}

async function assertAuthenticodeValid(paths: readonly string[]): Promise<void> {
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe")
  const command = "$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json $env:CODEPILOTX_SIGNATURE_PATHS; foreach($path in $paths){ $status=(Get-AuthenticodeSignature -LiteralPath $path).Status; Write-Output \"$path`t$status\"; if($status -ne 'Valid'){ exit 12 } }"
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"))
  const child = Bun.spawn([powershell, "-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: root,
    env: { ...environment, CODEPILOTX_SIGNATURE_PATHS: JSON.stringify(paths) },
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error("Windows Authenticode 验证失败")
}

async function assertPackagedPiCatalog(agentPath: string): Promise<void> {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "codepilotx-package-pi-"))
  const token = crypto.randomUUID()
  const child = spawn(agentPath, [], {
    cwd: isolatedRoot,
    env: {
      ...process.env,
      CODEPILOTX_AUTH_TOKEN: token,
      CODEPILOTX_DATA_DIR: join(isolatedRoot, "data"),
      CODEPILOTX_LOG_DIR: join(isolatedRoot, "logs"),
      CODEPILOTX_DESKTOP_MANAGED: "1",
      CODEPILOTX_PORT: "0",
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let stderr = ""
  child.stderr?.on("data", chunk => {
    if (stderr.length < 16_384) stderr += String(chunk)
  })
  try {
    const origin = await waitForPackagedAgent(child)
    let sequence = 0
    let connectionId = ""
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(`${origin}/rpc`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(connectionId
            ? { "x-codepilotx-connection-id": connectionId }
            : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `package-verifier:${++sequence}`,
          method,
          params,
        }),
      })
      const payload = await response.json() as {
        result?: Record<string, unknown>
        error?: unknown
      }
      if (!response.ok || payload.error) {
        throw new Error(`${method} 失败：${JSON.stringify(payload.error)}`)
      }
      return payload.result ?? {}
    }
    const initialized = await call("initialize", {
      clientInfo: {
        name: "windows-package-verifier",
        version: "1.0.0",
        platform: "win32",
      },
      protocols: ["thread-rpc-v4"],
      capabilities: [...verifierCapabilities],
      interactionDelivery: "active",
    })
    if (typeof initialized.connectionId !== "string") {
      throw new Error("打包 Agent 未返回 connectionId")
    }
    connectionId = initialized.connectionId
    await fetch(`${origin}/rpc`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-codepilotx-connection-id": connectionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialized",
        params: { protocol: "thread-rpc-v4" },
      }),
    })
    const providerResult = await call("provider/list", {})
    const providers = Array.isArray(providerResult.providers)
      ? providerResult.providers as Array<Record<string, unknown>>
      : []
    if (
      providers.length === 0 ||
      providers.some(provider => {
        const source = provider.source
        return !source || typeof source !== "object"
          || (source as Record<string, unknown>).type !== "pi"
      })
    ) {
      throw new Error("打包 Agent 未能从 Pi 加载 Provider 目录")
    }
    const modelResult = await call("model/list", {})
    const modelGroups = Array.isArray(modelResult.providers)
      ? modelResult.providers as Array<Record<string, unknown>>
      : []
    const models = modelGroups.flatMap(group =>
      Array.isArray(group.models)
        ? group.models as Array<Record<string, unknown>>
        : [],
    )
    if (
      models.length === 0 ||
      models.some(model => {
        const api = model.api
        return !api || typeof api !== "object"
          || (api as Record<string, unknown>).type !== "pi"
      })
    ) {
      throw new Error("打包 Agent 未能从 Pi 加载模型目录")
    }
  } catch (cause) {
    throw new Error(
      `打包 Agent Pi 目录运行验证失败${stderr ? `：${stderr.trim()}` : ""}`,
      { cause },
    )
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await new Promise<void>(resolveExit => {
        const timeout = setTimeout(resolveExit, 5_000)
        child.once("exit", () => {
          clearTimeout(timeout)
          resolveExit()
        })
      })
    }
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        await rm(isolatedRoot, { recursive: true, force: true })
        break
      } catch (cause) {
        if (
          !(cause instanceof Error)
          || !("code" in cause)
          || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(cause.code))
          || attempt === 79
        ) {
          throw cause
        }
        await Bun.sleep(100)
      }
    }
  }
}

async function waitForPackagedAgent(child: ChildProcess): Promise<string> {
  if (!child.stdout) throw new Error("无法读取打包 Agent 启动输出")
  const lines = createInterface({ input: child.stdout })
  return new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    const timeout = setTimeout(
      () => finish(new Error("打包 Agent 在 60 秒内未就绪")),
      60_000,
    )
    const finish = (result: string | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      lines.close()
      if (result instanceof Error) rejectReady(result)
      else resolveReady(result)
    }
    lines.on("line", line => {
      let message: { type?: string; url?: string } | undefined
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        return
      }
      if (message?.type === "ready" && typeof message.url === "string") {
        finish(message.url)
      }
    })
    child.once("error", cause => {
      finish(new Error(`打包 Agent 启动失败：${String(cause)}`))
    })
    child.once("exit", code => {
      finish(new Error(`打包 Agent 提前退出 (${code ?? "signal"})`))
    })
  })
}
