import { normalizeDesktopThreadDeepLinkPayload } from "./desktop-deep-link-ipc.js"

export const DESKTOP_WINDOW_IPC_CHANNELS = {
  openWindow: "window:open",
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
} as const

export type DesktopOpenWindowInput =
  | { kind: "home" }
  | { kind: "thread"; threadId: string }

export interface DesktopWindowIpcBridge {
  openWindow(input: DesktopOpenWindowInput): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
}

export function normalizeDesktopOpenWindowInput(
  value: unknown,
): DesktopOpenWindowInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const input = value as Record<string, unknown>
  if (input.kind === "home") {
    return Object.keys(input).length === 1 ? { kind: "home" } : null
  }
  if (input.kind !== "thread") return null
  if (
    Object.keys(input).length !== 2
    || !Object.hasOwn(input, "threadId")
  ) return null

  const normalized = normalizeDesktopThreadDeepLinkPayload(input)
  return normalized
    ? { kind: "thread", threadId: normalized.threadId }
    : null
}
