import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
if (process.argv.slice(2).join(" ") !== "--x64") {
  throw new Error("Windows 打包当前仅支持：bun scripts/package-win.ts --x64")
}

await run(["bun", "run", "build"])
const requireSigning = process.env.CODEPILOTX_REQUIRE_SIGNING === "1"
if (requireSigning) await run(["bun", "scripts/sign-win-agent.ts"])
await run(["bun", "run", "--cwd", "apps/desktop/electron", "package:win"])
await run([
  "bun",
  "scripts/verify-win-x64-package.ts",
  ...(requireSigning ? ["--require-signing"] : []),
])
await run(["bun", "scripts/smoke-win-x64.ts"])

async function run(command: readonly string[]): Promise<void> {
  const child = Bun.spawn([...command], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
}
