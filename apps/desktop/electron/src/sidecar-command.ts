import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1]
}

function firstExisting(candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate))
}

export function resolveBunExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.CODEPILOTX_BUN_PATH?.trim()
  if (explicit) return explicit

  const bunInstall = env.BUN_INSTALL?.trim()
  if (bunInstall) {
    const installed = firstExisting([
      join(bunInstall, "bin", platform === "win32" ? "bun.exe" : "bun"),
      join(bunInstall, platform === "win32" ? "bun.exe" : "bun"),
    ])
    if (installed) return installed
  }

  const pathEntries = (envValue(env, "PATH") ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)

  const candidates = pathEntries.flatMap((entry) => platform === "win32"
    ? [join(entry, "bun.exe"), join(entry, "node_modules", "bun", "bin", "bun.exe")]
    : [join(entry, "bun")])
  const executable = firstExisting(candidates)
  if (executable) return executable

  throw new Error("未找到 Bun 可执行文件。请通过 bun run dev:desktop 启动完整开发环境，或设置 CODEPILOTX_BUN_PATH。")
}
