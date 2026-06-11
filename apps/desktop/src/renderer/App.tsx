import type React from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes.js'
import { DesktopSettingsProvider } from './features/settings/useDesktopSettings.js'
import { DesktopThemeProvider } from './features/theme/themeContext.js'
import { TooltipProvider } from './components/ui/Tooltip.js'

export function App(): React.ReactNode {
  return (
    <DesktopThemeProvider>
      <DesktopSettingsProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </DesktopSettingsProvider>
    </DesktopThemeProvider>
  )
}
