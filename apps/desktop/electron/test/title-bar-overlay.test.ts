import { describe, expect, test } from "bun:test"
import {
  createTitleBarOverlayUpdateHandler,
  requireDesktopTitleBarOverlay,
} from "../src/ipc/title-bar-overlay.js"

const VALID_OVERLAY = {
  backgroundColor: "#f7f7f5",
  foregroundColor: "#202020",
  height: 40,
}

describe("Windows title bar overlay", () => {
  test("accepts the bounded renderer payload", () => {
    expect(requireDesktopTitleBarOverlay(VALID_OVERLAY)).toEqual(VALID_OVERLAY)
  })

  test("rejects malformed colors and heights", () => {
    expect(() => requireDesktopTitleBarOverlay({
      ...VALID_OVERLAY,
      backgroundColor: "rgb(1, 2, 3)",
    })).toThrow("标题栏外观参数无效")
    expect(() => requireDesktopTitleBarOverlay({
      ...VALID_OVERLAY,
      height: 81,
    })).toThrow("标题栏外观参数无效")
  })

  test("only updates the Windows main window", () => {
    const mainWindow = {}
    const updates: unknown[] = []
    const handler = createTitleBarOverlayUpdateHandler({
      isMainWindowSender: sender => sender === mainWindow,
      updateTitleBarOverlay: overlay => updates.push(overlay),
      platform: "win32",
    })

    handler(mainWindow, VALID_OVERLAY)
    expect(updates).toEqual([VALID_OVERLAY])
    expect(() => handler({}, VALID_OVERLAY)).toThrow(
      "IPC 调用来源无效",
    )
  })

  test("does not call the Windows API on other platforms", () => {
    let updates = 0
    const handler = createTitleBarOverlayUpdateHandler({
      isMainWindowSender: () => true,
      updateTitleBarOverlay: () => {
        updates += 1
      },
      platform: "darwin",
    })

    handler({}, VALID_OVERLAY)
    expect(updates).toBe(0)
  })
})
