import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { DESKTOP_BROWSER_IPC_CHANNELS } from "@codepilotx/shared/desktop-browser-ipc"

describe("内置浏览器 IPC 契约", () => {
  test("preload literal 与共享通道保持一致", async () => {
    expect(DESKTOP_BROWSER_IPC_CHANNELS.stateChanged).toBe(
      "desktop-browser:state-changed",
    )
    const preload = await readSource("../src/preload.cts")
    expect(preload).toContain('getState: "desktop-browser:get-state"')
    expect(preload).toContain(
      'typeof import("@codepilotx/shared/desktop-browser-ipc").DESKTOP_BROWSER_IPC_CHANNELS',
    )
  })

  test("所有 handler 都要求主 renderer 来源", async () => {
    const source = await readSource("../src/ipc/register-browser-ipc.ts")
    expect(source).toContain("requireMainWindowSender(event.sender, isMainWindowSender)")
    expect(source).toContain("const value = tabInput(event.sender, input)")
    expect(source).not.toContain("ipcRenderer")
  })
})

function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}
