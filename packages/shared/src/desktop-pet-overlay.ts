export const PET_OVERLAY_CHANNELS = {
  open: "pet-overlay:open",
  hide: "pet-overlay:hide",
  getState: "pet-overlay:get-state",
  beginDrag: "pet-overlay:drag-begin",
  updateDrag: "pet-overlay:drag-update",
  endDrag: "pet-overlay:drag-end",
  setPointerPassthrough: "pet-overlay:pointer-passthrough",
  requestKeyboardFocus: "pet-overlay:keyboard-focus",
  openSession: "pet-overlay:open-session",
} as const

export type DesktopPetOverlayBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopPetOverlayWindowState = {
  open: boolean
  bounds: DesktopPetOverlayBounds
}

export interface DesktopPetOverlayBridge {
  openPetOverlay(): Promise<void>
  hidePetOverlay(): Promise<void>
  getPetOverlayWindowState(): Promise<DesktopPetOverlayWindowState>
  beginPetDrag(): void
  updatePetDrag(): void
  endPetDrag(): void
  setPetPointerPassthrough(passthrough: boolean): void
  requestPetKeyboardFocus(focused: boolean): Promise<void>
  openPetSession(sessionId: string): Promise<void>
  onPetOpenSession(listener: (sessionId: string) => void): () => void
}
