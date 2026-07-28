import { useOutletContext } from 'react-router-dom'
import type { DesktopInstalledSkill } from '../../../../shared/types.js'

export type DesktopLayoutOutletContextValue = {
  workspacePath: string | null
  useSkill: (skill: DesktopInstalledSkill) => void
}

export function useDesktopLayoutOutletContext(): DesktopLayoutOutletContextValue {
  return useOutletContext<DesktopLayoutOutletContextValue>()
}
