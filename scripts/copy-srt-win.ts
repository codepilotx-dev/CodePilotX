import { copyFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const sourceRoot = resolve(root, "apps/agent/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win")
const resourceRoot = resolve(root, "resources/srt-win")
const noticeRoot = resolve(root, "third_party/sandbox-runtime")

await mkdir(resourceRoot, { recursive: true })
await mkdir(noticeRoot, { recursive: true })

for (const architecture of ["x64", "arm64"] as const) {
  const target = resolve(resourceRoot, architecture)
  await mkdir(target, { recursive: true })
  await copyFile(resolve(sourceRoot, architecture, "srt-win.exe"), resolve(target, "srt-win.exe"))
}

await copyFile(resolve(root, "apps/agent/node_modules/@anthropic-ai/sandbox-runtime/LICENSE"), resolve(noticeRoot, "LICENSE"))
console.log("[CodePilotX] copied SRT Windows helpers and Apache-2.0 license")
