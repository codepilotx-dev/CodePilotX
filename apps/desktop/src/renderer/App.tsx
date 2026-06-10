import type React from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes.js'
import { DesktopSettingsProvider } from './features/settings/useDesktopSettings.js'
import { DesktopThemeProvider } from './features/theme/themeContext.js'

export function App(): React.ReactNode {
  return (
    <DesktopThemeProvider>
      <DesktopSettingsProvider>
        <RouterProvider router={router} />
      </DesktopSettingsProvider>
    </DesktopThemeProvider>
  )
}
