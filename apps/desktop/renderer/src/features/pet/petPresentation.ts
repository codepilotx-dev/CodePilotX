import type { DesktopPetSettings } from '../../../shared/types.js'
import type {
  DesktopPetPresentation,
  DesktopPetOverlayWindowState,
} from '@codepilotx/shared/desktop-pet-overlay'

export type PetPresentation = DesktopPetPresentation

type PetPresentationBridge = {
  previewPetPresentation?: (
    presentation: PetPresentation,
  ) => void | Promise<void>
  onPetPresentationPreview?: (
    listener: (presentation: PetPresentation) => void,
  ) => () => void
  getPetGlobalPointerPosition?: () => Promise<{ x: number; y: number }>
  getPetOverlayWindowState?: () => Promise<DesktopPetOverlayWindowState>
}

export function presentationFromPetSettings(
  settings: DesktopPetSettings,
): PetPresentation {
  return {
    selectedPetId: settings.selectedPetId,
    size: settings.size,
  }
}

export function getPetPresentationBridge(): PetPresentationBridge | undefined {
  return window.codePilotXDesktop as
    | (typeof window.codePilotXDesktop & PetPresentationBridge)
    | undefined
}
