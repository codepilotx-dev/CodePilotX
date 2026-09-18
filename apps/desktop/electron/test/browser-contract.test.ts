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

  test("所有 handler 都按受管 renderer 窗口隔离 Browser owner", async () => {
    const source = await readSource("../src/ipc/register-browser-ipc.ts")
    expect(source).toContain("const owner = senderWindow(event.sender)")
    expect(source).toContain('if (!owner) throw new Error("IPC 调用来源无效")')
    expect(source).toContain("controller.getState(owner, value.tabId)")
    expect(source).toContain("controller.createOrRestore(owner, value.tabId, value.url)")
    expect(source).not.toContain("ipcRenderer")
  })
})

function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}
