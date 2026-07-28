import type React from 'react'
import { SettingsLayout } from '../settings/SettingsLayout.js'

export function ProjectsView(): React.ReactNode {
  return <SettingsLayout activeTabOverride="environment" />
}
