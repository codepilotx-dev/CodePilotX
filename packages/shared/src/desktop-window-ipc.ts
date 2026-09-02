import { normalizeDesktopThreadDeepLinkPayload } from "./desktop-deep-link-ipc.js"

export const DESKTOP_WINDOW_IPC_CHANNELS = {
  openWindow: "window:open",
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
  getPageZoom: "window:page-zoom:get",
  changePageZoom: "window:page-zoom:change",
  pageZoomChanged: "window:page-zoom:changed",
} as const

export type DesktopOpenWindowInput =
  | { kind: "home" }
  | { kind: "thread"; threadId: string }

export type DesktopPageZoomAction = "in" | "out" | "reset"

export type DesktopPageZoomState = {
  percent: number
  canZoomIn: boolean
  canZoomOut: boolean
}

export interface DesktopWindowIpcBridge {
  openWindow(input: DesktopOpenWindowInput): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  getPageZoom(): Promise<DesktopPageZoomState>
  changePageZoom(action: DesktopPageZoomAction): Promise<DesktopPageZoomState>
  onPageZoomChanged(
    listener: (state: DesktopPageZoomState) => void,
  ): () => void
}

export function isDesktopPageZoomAction(
  value: unknown,
): value is DesktopPageZoomAction {
  return value === "in" || value === "out" || value === "reset"
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
