import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

console.log("\n[CodePilotX] SRT Windows resources")
const srt = Bun.spawn(["bun", "scripts/copy-srt-win.ts", "--x64"], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
if (await srt.exited !== 0) process.exit(1)

for (const [label, command] of [
  ["共享协议类型检查", ["bun", "run", "--cwd", "packages/shared", "typecheck"]],
  ["Renderer 构建", ["bun", "run", "--cwd", "apps/desktop/renderer", "build"]],
  ["Agent 构建", ["bun", "run", "--cwd", "apps/agent", "build"]],
  ["Electron 构建", ["bun", "run", "--cwd", "apps/desktop/electron", "build"]],
] as const) {
  console.log(`\n[CodePilotX] ${label}`)
  const child = Bun.spawn(command, { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  if (code !== 0) process.exit(code)
}
