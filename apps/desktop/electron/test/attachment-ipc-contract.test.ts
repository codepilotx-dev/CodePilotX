import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { DESKTOP_ATTACHMENT_IPC_CHANNELS } from "@codepilotx/shared/desktop-attachment-ipc"

describe("用户附件 IPC 契约", () => {
  test("preload literal 与共享通道保持一致", async () => {
    expect(DESKTOP_ATTACHMENT_IPC_CHANNELS).toEqual({
      saveToDownloads: "desktop-attachment:save-to-downloads",
      chooseComposerFiles: "desktop-attachment:choose-composer-files",
      grantComposerPaths: "desktop-attachment:grant-composer-paths",
      readComposerPathGrant: "desktop-attachment:read-composer-path-grant",
      listComposerPathGrant: "desktop-attachment:list-composer-path-grant",
    })
    const preload = await readSource("../src/preload.cts")
    expect(preload).toContain(
      'saveToDownloads: "desktop-attachment:save-to-downloads"',
    )
    expect(preload).toContain(
      'typeof import("@codepilotx/shared/desktop-attachment-ipc").DESKTOP_ATTACHMENT_IPC_CHANNELS',
    )
    expect(preload).toContain('webUtils.getPathForFile(file)')
    expect(preload).toContain("pendingComposerDropPaths.has(path)")
    expect(preload).not.toContain("readFile(")
  })

  test("下载 handler 在调用服务前校验主 renderer 来源", async () => {
    const source = await readSource("../src/ipc/register-desktop-ipc.ts")
    const handler = source.slice(
      source.indexOf("DESKTOP_ATTACHMENT_IPC_CHANNELS.saveToDownloads"),
      source.indexOf("DESKTOP_WINDOW_IPC_CHANNELS.minimize"),
    )
    expect(handler).toContain("requireMainWindowSender(event, windows)")
    expect(handler).toContain("attachmentDownloads.save(input)")
  })

  test("Windows 文件入口只启用多文件选择，所有本地预览 handler 均校验主 renderer", async () => {
    const source = await readSource("../src/ipc/register-desktop-ipc.ts")
    const handlers = source.slice(
      source.indexOf("DESKTOP_ATTACHMENT_IPC_CHANNELS.chooseComposerFiles"),
      source.indexOf("DESKTOP_WINDOW_IPC_CHANNELS.minimize"),
    )
    expect(handlers).toContain('properties: ["openFile", "multiSelections"]')
    expect(handlers).not.toContain('"openDirectory"')
    expect(handlers.match(/requireMainWindowSender\(event, windows\)/g)?.length)
      .toBe(4)
    expect(handlers).toContain("composerPathGrants.grantPaths(event.sender.id")
    expect(handlers).toContain("composerPathGrants.read(event.sender.id")
    expect(handlers).toContain("composerPathGrants.list(event.sender.id")
  })
})

function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}
