import type React from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes.js'
import { DesktopSettingsProvider } from './features/settings/useDesktopSettings.js'
import { DesktopThemeProvider } from './features/theme/themeContext.js'
import { TooltipProvider } from './components/ui/Tooltip.js'
import { GlobalErrorModal } from './components/GlobalErrorModal.js'
import { useEffect, useState } from 'react'
import { fullErrorMessage, isResizeObserverLoopError } from './utils/errors.js'

export function App(): React.ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const showError = (error: unknown): void => {
      setErrorMessage(fullErrorMessage(error))
    }
    const handleError = (event: ErrorEvent): void => {
      if (
        isResizeObserverLoopError(event.error) ||
        isResizeObserverLoopError(event.message)
      ) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      showError(event.error ?? event.message)
    }
    const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
      if (isResizeObserverLoopError(event.reason)) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      showError(event.reason)
    }
    const handleDesktopError = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail : null
      showError(detail)
    }

    window.addEventListener('error', handleError, true)
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true)
    window.addEventListener('desktop:error', handleDesktopError)
    return () => {
      window.removeEventListener('error', handleError, true)
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection,
        true,
      )
      window.removeEventListener('desktop:error', handleDesktopError)
    }
  }, [])

  return (
    <DesktopThemeProvider>
      <DesktopSettingsProvider>
        <TooltipProvider>
          <GlobalErrorModal
            message={errorMessage}
            onDismiss={() => setErrorMessage(null)}
          />
          <RouterProvider router={router} />
        </TooltipProvider>
      </DesktopSettingsProvider>
    </DesktopThemeProvider>
  )
}
