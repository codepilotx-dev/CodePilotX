import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { assertAgentBinaryHasNoStaticRiskFeatures } from "./agent-pe-signatures"
import { assertWindowsX64PE } from "./windows-pe"

const root = resolve(import.meta.dir, "..")
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
  join(unpacked, "resources/agent/models.snapshot.json"),
  join(unpacked, "resources/agent/models.snapshot.meta.json"),
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
