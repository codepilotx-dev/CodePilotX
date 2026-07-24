import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const MAIN_WINDOW_MIN_WIDTH = 960
export const MAIN_WINDOW_MIN_HEIGHT = 640
const DEFAULT_WINDOW_WIDTH = 1440
const DEFAULT_WINDOW_HEIGHT = 920
const WINDOW_STATE_VERSION = 1
const WINDOW_STATE_WRITE_DELAY_MS = 250

export type DesktopWindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopWindowStateV1 = {
  version: 1
  bounds: DesktopWindowBounds
  maximized: boolean
}

export type DesktopDisplayWorkArea = DesktopWindowBounds

export interface WindowStateLogger {
  warn(event: string, fields?: Record<string, unknown>): void
}

export class WindowStateStore {
  readonly #filePath: string
  readonly #logger: WindowStateLogger | undefined
  #pendingState: DesktopWindowStateV1 | undefined
  #writeTimer: ReturnType<typeof setTimeout> | undefined
  #writeQueue: Promise<void> = Promise.resolve()

  constructor(
    userDataDirectory: string,
    logger?: WindowStateLogger,
    fileName = "window-state.json",
  ) {
    this.#filePath = join(userDataDirectory, fileName)
    this.#logger = logger
  }

  get filePath(): string {
    return this.#filePath
  }

  async load(
    displays: readonly DesktopDisplayWorkArea[],
    primaryDisplay: DesktopDisplayWorkArea,
  ): Promise<DesktopWindowStateV1> {
    try {
      const source = await readFile(this.#filePath, "utf8")
      return normalizeWindowState(JSON.parse(source), displays, primaryDisplay)
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.#logger?.warn("window-state.load-failed", { error })
      }
      return createDefaultWindowState(primaryDisplay)
    }
  }

  scheduleSave(state: DesktopWindowStateV1): void {
    this.#pendingState = state
    if (this.#writeTimer) clearTimeout(this.#writeTimer)
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = undefined
      this.#enqueuePendingWrite()
    }, WINDOW_STATE_WRITE_DELAY_MS)
  }

  async flush(): Promise<void> {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer)
      this.#writeTimer = undefined
    }
    this.#enqueuePendingWrite()
    await this.#writeQueue
  }

  #enqueuePendingWrite(): void {
    const state = this.#pendingState
    if (!state) return
    this.#pendingState = undefined
    const write = this.#writeQueue.then(() => this.#writeAtomically(state))
    this.#writeQueue = write.catch((error) => {
      this.#logger?.warn("window-state.save-failed", { error })
    })
  }

  async #writeAtomically(state: DesktopWindowStateV1): Promise<void> {
    const directory = dirname(this.#filePath)
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      await rename(temporaryPath, this.#filePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

export function createDefaultWindowState(
  primaryDisplay: DesktopDisplayWorkArea,
): DesktopWindowStateV1 {
  const width = Math.min(DEFAULT_WINDOW_WIDTH, primaryDisplay.width)
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, primaryDisplay.height)
  return {
    version: 1,
    bounds: {
      x: Math.round(primaryDisplay.x + (primaryDisplay.width - width) / 2),
      y: Math.round(primaryDisplay.y + (primaryDisplay.height - height) / 2),
      width,
      height,
    },
    maximized: false,
  }
}

export function normalizeWindowState(
  value: unknown,
  displays: readonly DesktopDisplayWorkArea[],
  primaryDisplay: DesktopDisplayWorkArea,
): DesktopWindowStateV1 {
  if (!isWindowState(value)) return createDefaultWindowState(primaryDisplay)

  const availableDisplays = displays.length > 0 ? displays : [primaryDisplay]
  const targetDisplay = availableDisplays
    .map(display => ({
      display,
      overlap: intersectionArea(value.bounds, display),
    }))
    .sort((left, right) => right.overlap - left.overlap)[0]

  if (!targetDisplay || targetDisplay.overlap === 0) {
    return {
      ...createDefaultWindowState(primaryDisplay),
      maximized: value.maximized,
    }
  }

  const workArea = targetDisplay.display
  const width = Math.min(
    Math.max(value.bounds.width, Math.min(MAIN_WINDOW_MIN_WIDTH, workArea.width)),
    workArea.width,
  )
  const height = Math.min(
    Math.max(value.bounds.height, Math.min(MAIN_WINDOW_MIN_HEIGHT, workArea.height)),
    workArea.height,
  )
  return {
    version: 1,
    bounds: {
      x: clamp(value.bounds.x, workArea.x, workArea.x + workArea.width - width),
      y: clamp(value.bounds.y, workArea.y, workArea.y + workArea.height - height),
      width,
      height,
    },
    maximized: value.maximized,
  }
}

function isWindowState(value: unknown): value is DesktopWindowStateV1 {
  if (!isRecord(value) || value.version !== WINDOW_STATE_VERSION) return false
  if (typeof value.maximized !== "boolean" || !isRecord(value.bounds)) return false
  const bounds = value.bounds
  return ["x", "y", "width", "height"].every(
    key => typeof bounds[key] === "number"
      && Number.isFinite(bounds[key]),
  ) && typeof bounds.width === "number"
    && typeof bounds.height === "number"
    && bounds.width > 0
    && bounds.height > 0
}

function intersectionArea(
  left: DesktopWindowBounds,
  right: DesktopWindowBounds,
): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width)
      - Math.max(left.x, right.x),
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height)
      - Math.max(left.y, right.y),
  )
  return width * height
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(maximum, Math.max(minimum, value)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}
