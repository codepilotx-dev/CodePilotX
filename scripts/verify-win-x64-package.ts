import { existsSync } from "node:fs"
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
const srt = join(unpacked, "resources/srt-win/x64/srt-win.exe")
const requiredFiles = [application, agent, srt]
for (const path of requiredFiles) {
  if (!existsSync(path)) throw new Error(`Windows x64 包缺少文件：${path}`)
  await assertWindowsX64PE(path)
}
await assertAgentBinaryHasNoStaticRiskFeatures(agent)

if (requireSigning) {
  const artifacts = await readdir(resolve(root, "release"))
  const installerPaths = artifacts
    .filter(name => /^CodePilotX-.*-x64\.exe$/i.test(name))
    .map(name => resolve(root, "release", name))
  const installers = await Promise.all(installerPaths.map(async path => ({ path, modifiedAt: (await stat(path)).mtimeMs })))
  const installer = installers.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.path
  if (!installer) throw new Error("未找到 x64 NSIS 安装器")
  await assertAuthenticodeValid([application, agent, installer])
}

console.log(`[CodePilotX] Windows x64 package verified: ${unpacked}`)

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
