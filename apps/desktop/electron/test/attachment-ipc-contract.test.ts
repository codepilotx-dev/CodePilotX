import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { DESKTOP_ATTACHMENT_IPC_CHANNELS } from "@codepilotx/shared/desktop-attachment-ipc"

describe("用户附件 IPC 契约", () => {
  test("preload literal 与共享通道保持一致", async () => {
    expect(DESKTOP_ATTACHMENT_IPC_CHANNELS).toEqual({
      saveToDownloads: "desktop-attachment:save-to-downloads",
    })
    const preload = await readSource("../src/preload.cts")
    expect(preload).toContain(
      'saveToDownloads: "desktop-attachment:save-to-downloads"',
    )
    expect(preload).toContain(
      'typeof import("@codepilotx/shared/desktop-attachment-ipc").DESKTOP_ATTACHMENT_IPC_CHANNELS',
    )
  })

  test("下载 handler 在调用服务前校验主 renderer 来源", async () => {
    const source = await readSource("../src/ipc/register-desktop-ipc.ts")
    const handler = source.slice(
      source.indexOf("DESKTOP_ATTACHMENT_IPC_CHANNELS.saveToDownloads"),
      source.indexOf('ipcMain.handle("window:minimize"'),
    )
    expect(handler).toContain("requireMainWindowSender(event, windows)")
    expect(handler).toContain("attachmentDownloads.save(input)")
  })
})

function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}
