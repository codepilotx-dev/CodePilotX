import { ipcMain, type WebContents } from "electron"
import {
  DESKTOP_BROWSER_IPC_CHANNELS,
  type CreateOrRestoreDesktopBrowserInput,
  type DesktopBrowserTabInput,
  type NavigateDesktopBrowserInput,
  type SetDesktopBrowserBoundsInput,
  type SetDesktopBrowserVisibleInput,
} from "@codepilotx/shared/desktop-browser-ipc"
import type { DesktopBrowserController } from "../browser/browser-controller.js"

interface BrowserIpcDependencies {
  controller: DesktopBrowserController
  isMainWindowSender(sender: WebContents): boolean
}

export function registerBrowserIpc(dependencies: BrowserIpcDependencies): void {
  const { controller, isMainWindowSender } = dependencies
  const tabInput = (sender: WebContents, input: unknown): DesktopBrowserTabInput => {
    requireMainWindowSender(sender, isMainWindowSender)
    return requireTabInput(input)
  }

  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.getState, (event, input) => {
    const value = tabInput(event.sender, input)
    return controller.getState(value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.createOrRestore, (event, input) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    const value = requireCreateInput(input)
    return controller.createOrRestore(value.tabId, value.url)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.navigate, async (event, input) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    const value = requireNavigateInput(input)
    return controller.navigate(value.tabId, value.url)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.reload, (event, input) => {
    const value = tabInput(event.sender, input)
    return controller.reload(value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.stop, (event, input) => {
    const value = tabInput(event.sender, input)
    return controller.stop(value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.goBack, (event, input) => {
    const value = tabInput(event.sender, input)
    return controller.goBack(value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.goForward, (event, input) => {
    const value = tabInput(event.sender, input)
    return controller.goForward(value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.setBounds, (event, input) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    const value = requireBoundsInput(input)
    return controller.setBounds(value.tabId, value.bounds)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.setVisible, (event, input) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    const value = requireVisibleInput(input)
    return controller.setVisible(value.tabId, value.visible)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.focus, (event, input) => {
    const value = tabInput(event.sender, input)
    controller.focus(value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.close, (event, input) => {
    const value = tabInput(event.sender, input)
    return controller.close(value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.clearAllowedSites, (event, input) => {
    const value = tabInput(event.sender, input)
    return controller.clearAllowedSites(value.tabId)
  })
}

function requireTabInput(value: unknown): DesktopBrowserTabInput {
  if (!isExactRecord(value, ["tabId"]) || !isIdentifier(value.tabId)) invalidInput()
  return value as unknown as DesktopBrowserTabInput
}

function requireCreateInput(value: unknown): CreateOrRestoreDesktopBrowserInput {
  if (!isRecord(value)) invalidInput()
  const keys = value.url === undefined ? ["tabId"] : ["tabId", "url"]
  if (
    !isExactRecord(value, keys)
    || !isIdentifier(value.tabId)
    || !(value.url === undefined || isUrlInput(value.url))
  ) invalidInput()
  return value as unknown as CreateOrRestoreDesktopBrowserInput
}

function requireNavigateInput(value: unknown): NavigateDesktopBrowserInput {
  if (
    !isExactRecord(value, ["tabId", "url"])
    || !isIdentifier(value.tabId)
    || !isUrlInput(value.url)
  ) invalidInput()
  return value as unknown as NavigateDesktopBrowserInput
}

function requireBoundsInput(value: unknown): SetDesktopBrowserBoundsInput {
  if (
    !isExactRecord(value, ["tabId", "bounds"])
    || !isIdentifier(value.tabId)
    || !isExactRecord(value.bounds, ["x", "y", "width", "height"])
    || ![value.bounds.x, value.bounds.y, value.bounds.width, value.bounds.height]
      .every(item => typeof item === "number" && Number.isFinite(item))
  ) invalidInput()
  return value as unknown as SetDesktopBrowserBoundsInput
}

function requireVisibleInput(value: unknown): SetDesktopBrowserVisibleInput {
  if (
    !isExactRecord(value, ["tabId", "visible"])
    || !isIdentifier(value.tabId)
    || typeof value.visible !== "boolean"
  ) invalidInput()
  return value as unknown as SetDesktopBrowserVisibleInput
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(value)
}

function isUrlInput(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 8_192
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
}

function invalidInput(): never {
  throw new Error("浏览器参数无效")
}

function requireMainWindowSender(
  sender: WebContents,
  isAllowed: (sender: WebContents) => boolean,
): void {
  if (!isAllowed(sender)) throw new Error("IPC 调用来源无效")
}
