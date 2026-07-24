import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { DesktopPetOverlayBounds } from "@codepilotx/shared/desktop-pet-overlay"
import type { DesktopDisplayWorkArea } from "./window-state.js"

export const PET_OVERLAY_WIDTH = 356
export const PET_OVERLAY_HEIGHT = 320
const PET_OVERLAY_MARGIN = 24
const WRITE_DELAY_MS = 250

export type PetOverlayWindowStateV1 = {
  version: 1
  bounds: DesktopPetOverlayBounds
}

type Logger = {
  warn(event: string, fields?: Record<string, unknown>): void
}

export class PetOverlayWindowStateStore {
  readonly #filePath: string
  readonly #logger?: Logger
  #pending?: PetOverlayWindowStateV1
  #timer?: ReturnType<typeof setTimeout>
  #queue: Promise<void> = Promise.resolve()

  constructor(userDataDirectory: string, logger?: Logger) {
    this.#filePath = join(userDataDirectory, "pet-overlay-window-state.json")
    this.#logger = logger
  }

  get filePath(): string {
    return this.#filePath
  }

  async load(
    displays: readonly DesktopDisplayWorkArea[],
    primaryDisplay: DesktopDisplayWorkArea,
  ): Promise<PetOverlayWindowStateV1> {
    try {
      const source = await readFile(this.#filePath, "utf8")
      return normalizePetOverlayWindowState(
        JSON.parse(source),
        displays,
        primaryDisplay,
      )
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.#logger?.warn("pet-overlay-state.load-failed", { error })
      }
      return createDefaultPetOverlayWindowState(primaryDisplay)
    }
  }

  scheduleSave(state: PetOverlayWindowStateV1): void {
    this.#pending = state
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#enqueue()
    }, WRITE_DELAY_MS)
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#enqueue()
    await this.#queue
  }

  #enqueue(): void {
    const state = this.#pending
    if (!state) return
    this.#pending = undefined
    const write = this.#queue.then(() => this.#write(state))
    this.#queue = write.catch(error => {
      this.#logger?.warn("pet-overlay-state.save-failed", { error })
    })
  }

  async #write(state: PetOverlayWindowStateV1): Promise<void> {
    const temporaryPath =
      `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(this.#filePath), { recursive: true })
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

export function createDefaultPetOverlayWindowState(
  workArea: DesktopDisplayWorkArea,
): PetOverlayWindowStateV1 {
  return {
    version: 1,
    bounds: {
      x: Math.round(
        workArea.x + workArea.width - PET_OVERLAY_WIDTH - PET_OVERLAY_MARGIN,
      ),
      y: Math.round(
        workArea.y + workArea.height - PET_OVERLAY_HEIGHT - PET_OVERLAY_MARGIN,
      ),
      width: PET_OVERLAY_WIDTH,
      height: PET_OVERLAY_HEIGHT,
    },
  }
}

export function normalizePetOverlayWindowState(
  value: unknown,
  displays: readonly DesktopDisplayWorkArea[],
  primaryDisplay: DesktopDisplayWorkArea,
): PetOverlayWindowStateV1 {
  if (!isState(value)) return createDefaultPetOverlayWindowState(primaryDisplay)
  const available = displays.length ? displays : [primaryDisplay]
  const target = available
    .map(display => ({ display, overlap: intersectionArea(value.bounds, display) }))
    .sort((left, right) => right.overlap - left.overlap)[0]
  if (!target || target.overlap === 0) {
    return createDefaultPetOverlayWindowState(primaryDisplay)
  }
  return {
    version: 1,
    bounds: clampBounds(value.bounds, target.display),
  }
}

export function clampPetOverlayBounds(
  bounds: DesktopPetOverlayBounds,
  workArea: DesktopDisplayWorkArea,
): DesktopPetOverlayBounds {
  return clampBounds(bounds, workArea)
}

function clampBounds(
  bounds: DesktopPetOverlayBounds,
  workArea: DesktopDisplayWorkArea,
): DesktopPetOverlayBounds {
  const width = Math.min(PET_OVERLAY_WIDTH, workArea.width)
  const height = Math.min(PET_OVERLAY_HEIGHT, workArea.height)
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  }
}

function intersectionArea(
  left: DesktopPetOverlayBounds,
  right: DesktopDisplayWorkArea,
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

function isState(value: unknown): value is PetOverlayWindowStateV1 {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bounds)) {
    return false
  }
  const bounds = value.bounds
  return ["x", "y", "width", "height"].every(
    key => typeof bounds[key] === "number"
      && Number.isFinite(bounds[key]),
  )
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
