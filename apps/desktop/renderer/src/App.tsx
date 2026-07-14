import type React from 'react'
import { RouterProvider } from 'react-router-dom'
import { GlobalErrorModal } from './components/GlobalErrorModal'
import { TooltipProvider } from './components/ui/Tooltip'
import { router } from './routes'
import { StaticDesktopSettingsProvider } from './features/settings/staticSettings'
import { DesktopThemeProvider } from './features/theme/themeContext'

export function App(): React.ReactNode {
  return (
    <DesktopThemeProvider>
      <StaticDesktopSettingsProvider>
        <TooltipProvider>
          <GlobalErrorModal message={null} onDismiss={() => {}} />
          <RouterProvider router={router} />
        </TooltipProvider>
      </StaticDesktopSettingsProvider>
    </DesktopThemeProvider>
  )
}

export default App
