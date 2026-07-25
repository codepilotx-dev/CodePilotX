import { copyFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { assertSrtHelperFile, verifySrtRuntimeManifest } from "./verify-srt-runtime-manifest"

if (process.argv.slice(2).join(" ") !== "--x64") {
  throw new Error("SRT Windows 资源当前仅支持：bun scripts/copy-srt-win.ts --x64")
}

const root = resolve(import.meta.dir, "..")
await verifySrtRuntimeManifest(root)

const sourceRoot = resolve(root, "apps/agent/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win")
const resourceRoot = resolve(root, "resources/srt-win")
const noticeRoot = resolve(root, "third_party/sandbox-runtime")

await mkdir(resourceRoot, { recursive: true })
await mkdir(noticeRoot, { recursive: true })

const target = resolve(resourceRoot, "x64")
await mkdir(target, { recursive: true })
const targetHelper = resolve(target, "srt-win.exe")
await copyFile(resolve(sourceRoot, "x64", "srt-win.exe"), targetHelper)
await assertSrtHelperFile(targetHelper, "x64")

await copyFile(resolve(root, "apps/agent/node_modules/@anthropic-ai/sandbox-runtime/LICENSE"), resolve(noticeRoot, "LICENSE"))
console.log("[CodePilotX] copied and verified SRT Windows x64 helper and Apache-2.0 license")
