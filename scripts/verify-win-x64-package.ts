import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { spawn, type ChildProcess } from "node:child_process"
import { assertAgentBinaryHasNoStaticRiskFeatures } from "./agent-pe-signatures"
import { parseSemver } from "./semver-utils"
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
const appUpdateConfiguration = join(unpacked, "resources/app-update.yml")
const nodePtyDirectory = join(
  unpacked,
  "resources/app.asar.unpacked/node_modules/node-pty",
)
const nodePtyManifest = join(nodePtyDirectory, "package.json")
const nodePtyLicense = join(nodePtyDirectory, "LICENSE")
const nodePtyNativeFiles = [
  join(nodePtyDirectory, "prebuilds/win32-x64/conpty.node"),
  join(nodePtyDirectory, "prebuilds/win32-x64/conpty_console_list.node"),
  join(nodePtyDirectory, "prebuilds/win32-x64/pty.node"),
]
const requiredFiles = [
  application,
  agent,
  appUpdateConfiguration,
  join(unpacked, "resources/app.asar"),
  join(unpacked, "resources/renderer/index.html"),
  join(unpacked, "resources/THIRD_PARTY_NOTICES.md"),
  nodePtyManifest,
  nodePtyLicense,
  ...nodePtyNativeFiles,
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
for (const path of nodePtyNativeFiles) {
  await assertWindowsX64PE(path)
}
const nodePtyPackage = JSON.parse(
  await readFile(nodePtyManifest, "utf8"),
) as { name?: unknown; version?: unknown; license?: unknown }
if (
  nodePtyPackage.name !== "node-pty"
  || nodePtyPackage.version !== "1.1.0"
  || nodePtyPackage.license !== "MIT"
) {
  throw new Error("Windows x64 包中的 node-pty 版本或许可证无效")
}
await assertAgentBinaryHasNoStaticRiskFeatures(agent)
await assertPackagedPiCatalog(agent)

const rootManifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
) as { version?: unknown }
if (typeof rootManifest.version !== "string") {
  throw new Error("根 package.json 缺少字符串类型的 version")
}
const parsedVersion = parseSemver(rootManifest.version)
if (!parsedVersion) {
  throw new Error(`版本 "${rootManifest.version}" 不符合发布 SemVer 规则`)
}
const updateChannel = parsedVersion.prereleaseType ?? "latest"
const releaseDirectory = resolve(root, "release")
const installerName = `CodePilotX-${rootManifest.version}-x64.exe`
const installer = resolve(releaseDirectory, installerName)
const blockmap = `${installer}.blockmap`
const updateMetadata = resolve(releaseDirectory, `${updateChannel}.yml`)
for (const path of [installer, blockmap, updateMetadata]) {
  if (!existsSync(path) || (await stat(path)).size === 0) {
    throw new Error(`Windows x64 更新产物缺失或为空：${path}`)
  }
}
await assertUpdaterConfiguration(
  appUpdateConfiguration,
  updateChannel,
)
await assertUpdaterMetadata(
  updateMetadata,
  rootManifest.version,
  installerName,
  (await stat(installer)).size,
)

if (requireSigning) {
  await assertAuthenticodeValid([application, agent, installer])
}

console.log(`[CodePilotX] Windows x64 package verified: ${unpacked}`)
console.log(`[CodePilotX] Installer: ${installer}`)
console.log(`[CodePilotX] Installer size: ${(await stat(installer)).size} bytes`)
console.log(`[CodePilotX] Installer SHA-256: ${await sha256(installer)}`)

async function assertUpdaterConfiguration(
  path: string,
  expectedChannel: string,
): Promise<void> {
  const configuration = await readFile(path, "utf8")
  for (const [key, expected] of [
    ["provider", "github"],
    ["owner", "codepilotx-dev"],
    ["repo", "CodePilotX"],
    ["channel", expectedChannel],
  ] as const) {
    const match = configuration.match(
      new RegExp(`^${key}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, "m"),
    )
    if (match?.[1] !== expected) {
      throw new Error(`app-update.yml 的 ${key} 配置无效`)
    }
  }
}

async function assertUpdaterMetadata(
  path: string,
  expectedVersion: string,
  expectedInstallerName: string,
  expectedInstallerSize: number,
): Promise<void> {
  const metadata = await readFile(path, "utf8")
  const version = metadata.match(/^version:\s*["']?([^"' \r\n]+)["']?\s*$/m)?.[1]
  if (version !== expectedVersion) {
    throw new Error(`更新元数据版本无效：${version ?? "missing"}`)
  }
  const installerUrls = [...metadata.matchAll(
    /^\s*-\s+url:\s*["']?([^"'\r\n]+\.exe)["']?\s*$/gmi,
  )].map(match => match[1])
  if (
    installerUrls.length !== 1
    || installerUrls[0] !== expectedInstallerName
  ) {
    throw new Error("更新元数据引用了非当前版本安装包")
  }
  const sha512Values = [...metadata.matchAll(
    /^\s+sha512:\s*([A-Za-z0-9+/=]+)\s*$/gm,
  )]
  if (sha512Values.length < 1 || sha512Values.some(match => match[1].length < 44)) {
    throw new Error("更新元数据缺少有效的 SHA-512")
  }
  const sizes = [...metadata.matchAll(/^\s+size:\s*(\d+)\s*$/gm)]
    .map(match => Number(match[1]))
  if (sizes.length < 1 || !sizes.includes(expectedInstallerSize)) {
    throw new Error("更新元数据中的安装包大小无效")
  }
}

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
