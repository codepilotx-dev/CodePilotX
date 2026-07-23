import { describe, expect, test } from "bun:test"
import {
  createDefaultPetOverlayWindowState,
  normalizePetOverlayWindowState,
} from "../src/windows/pet-overlay-window-state.js"

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1080 }
const SECONDARY = { x: 1920, y: 0, width: 1280, height: 1024 }

describe("pet overlay window state", () => {
  test("anchors the default overlay to the primary bottom-right margin", () => {
    expect(createDefaultPetOverlayWindowState(PRIMARY)).toEqual({
      version: 1,
      bounds: { x: 1540, y: 736, width: 356, height: 320 },
    })
  })

  test("restores on a secondary display and clamps off-screen bounds", () => {
    expect(
      normalizePetOverlayWindowState(
        {
          version: 1,
          bounds: { x: 3000, y: 900, width: 356, height: 320 },
        },
        [PRIMARY, SECONDARY],
        PRIMARY,
      ),
    ).toEqual({
      version: 1,
      bounds: { x: 2844, y: 704, width: 356, height: 320 },
    })
  })

  test("recovers a fully disconnected display to primary", () => {
    expect(
      normalizePetOverlayWindowState(
        {
          version: 1,
          bounds: { x: 9000, y: -4000, width: 356, height: 320 },
        },
        [PRIMARY],
        PRIMARY,
      ),
    ).toEqual(createDefaultPetOverlayWindowState(PRIMARY))
  })
})
