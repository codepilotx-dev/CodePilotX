import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
  DESKTOP_WINDOW_IPC_CHANNELS,
  normalizeDesktopOpenWindowInput,
} from "@codepilotx/shared/desktop-window-ipc"

describe("desktop multi-window contract", () => {
  test("validates controlled home and thread window inputs", () => {
    expect(DESKTOP_WINDOW_IPC_CHANNELS.openWindow).toBe("window:open")
    expect(normalizeDesktopOpenWindowInput({ kind: "home" })).toEqual({
      kind: "home",
    })
    expect(normalizeDesktopOpenWindowInput({
      kind: "thread",
      threadId: "thread:1",
    })).toEqual({ kind: "thread", threadId: "thread:1" })
    expect(normalizeDesktopOpenWindowInput({
      kind: "thread",
      threadId: " ",
    })).toBeNull()
    expect(normalizeDesktopOpenWindowInput({
      kind: "thread",
      threadId: "x".repeat(513),
    })).toBeNull()
    expect(normalizeDesktopOpenWindowInput({
      kind: "url",
      url: "https://example.com",
    })).toBeNull()
    expect(normalizeDesktopOpenWindowInput({
      kind: "home",
      unexpected: "value",
    })).toBeNull()
    expect(normalizeDesktopOpenWindowInput({
      kind: "thread",
      threadId: "thread:1",
      unexpected: "value",
    })).toBeNull()
  })

  test("preload exposes typed fixed-channel window operations", async () => {
    const preload = await readSource("../src/preload.cts")
    expect(preload).toContain('openWindow: "window:open"')
    expect(preload).toContain(
      "ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.openWindow, input)",
    )
    expect(DESKTOP_WINDOW_IPC_CHANNELS.getPageZoom).toBe("window:page-zoom:get")
    expect(DESKTOP_WINDOW_IPC_CHANNELS.changePageZoom).toBe("window:page-zoom:change")
    expect(DESKTOP_WINDOW_IPC_CHANNELS.pageZoomChanged).toBe("window:page-zoom:changed")
    expect(preload).toContain(
      "ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.changePageZoom, action)",
    )
    expect(preload).toContain(
      "ipcRenderer.on(DESKTOP_WINDOW_IPC_CHANNELS.pageZoomChanged, handler)",
    )
  })

  test("managed windows share the hardened BrowserWindow configuration", async () => {
    const source = await readSource("../src/windows/window-manager.ts")
    expect(source).toContain(
      "readonly #applicationWindows = new Map<number, BrowserWindow>()",
    )
    expect(source).toContain("contextIsolation: true")
    expect(source).toContain("nodeIntegration: false")
    expect(source).toContain("sandbox: true")
    expect(source).toContain("webSecurity: true")
    expect(source).toContain("createWindowsTitleBarOverlay")
    expect(source).toContain(
      "#/threads/${encodeURIComponent(input.threadId)}",
    )
  })

  test("window controls and dialogs resolve the invoking managed window", async () => {
    const source = await readSource("../src/ipc/register-desktop-ipc.ts")
    const handlers = source.slice(
      source.indexOf("DESKTOP_WINDOW_IPC_CHANNELS.openWindow"),
      source.indexOf("DESKTOP_UPDATE_IPC_CHANNELS.check"),
    )
    expect(handlers).toContain("windows.openWindow(normalized)")
    expect(handlers).toContain("requireMainWindowSender(event, windows).minimize()")
    expect(handlers).toContain("const target = requireMainWindowSender(event, windows)")
    expect(handlers).toContain("requireMainWindowSender(event, windows).close()")
    expect(handlers).toContain("requireMainWindowSender(event, windows)")
    expect(handlers).toContain("isDesktopPageZoomAction(action)")
    expect(handlers).toContain("windows.changePageZoom(action)")
    expect(handlers).not.toContain("windows.mainWindow")
    expect(source).toContain(
      "return windows.requireApplicationWindow(event.sender)",
    )
    expect(source).toContain("dialog.showOpenDialog(ownerWindow, options)")
  })
})

function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}
