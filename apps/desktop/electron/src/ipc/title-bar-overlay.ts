import type { DesktopTitleBarOverlay } from "@codepilotx/shared/desktop-appearance-ipc"

const TITLE_BAR_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function requireDesktopTitleBarOverlay(
  value: unknown,
): DesktopTitleBarOverlay {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("标题栏外观参数无效")
  }
  const overlay = value as Record<string, unknown>
  if (
    typeof overlay.backgroundColor !== "string"
    || !TITLE_BAR_COLOR_PATTERN.test(overlay.backgroundColor)
    || typeof overlay.foregroundColor !== "string"
    || !TITLE_BAR_COLOR_PATTERN.test(overlay.foregroundColor)
    || typeof overlay.height !== "number"
    || !Number.isInteger(overlay.height)
    || overlay.height < 24
    || overlay.height > 80
  ) {
    throw new Error("标题栏外观参数无效")
  }
  return {
    backgroundColor: overlay.backgroundColor,
    foregroundColor: overlay.foregroundColor,
    height: overlay.height,
  }
}

export function createTitleBarOverlayUpdateHandler<Sender>(dependencies: {
  isMainWindowSender: (sender: Sender) => boolean
  updateTitleBarOverlay: (overlay: DesktopTitleBarOverlay) => void
  platform?: NodeJS.Platform
}): (sender: Sender, value: unknown) => void {
  return (sender, value) => {
    if (!dependencies.isMainWindowSender(sender)) {
      throw new Error("IPC 调用来源无效")
    }
    const overlay = requireDesktopTitleBarOverlay(value)
    if ((dependencies.platform ?? process.platform) === "win32") {
      dependencies.updateTitleBarOverlay(overlay)
    }
  }
}
