import React from 'react'
import {
  DESKTOP_BROWSER_DEBUG_MODE_EVENT,
  readDesktopBrowserDebugMode,
} from '../../services/desktopClient.js'

type Props = {
  title: string
  description?: React.ReactNode
  control?: React.ReactNode
  autoSave?: boolean
}

export function SettingsRow({ title, description, control, autoSave }: Props) {
  return (
    <div className="settings-row tw:flex tw:items-center tw:gap-4 tw:bg-transparent tw:px-4 tw:py-3.5">
      <div className="settings-row-info tw:min-w-0 tw:flex-1">
        <h4 className="settings-row-title tw:mt-0 tw:mb-0.5 tw:text-base tw:font-[var(--font-weight-body)] tw:text-app-text">{title}</h4>
        {description && <p className="settings-row-desc tw:m-0 tw:text-sm tw:leading-5 tw:text-app-text-soft">{description}</p>}
      </div>
      {control && (
        <div className="settings-row-control tw:relative tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:justify-end tw:gap-2">
          {autoSave ? <SettingsAutoSaveBadge /> : null}
          {control}
        </div>
      )}
    </div>
  )
}

export function SettingsAutoSaveBadge(): React.ReactNode {
  const debugMode = useDesktopDebugMode()
  if (!debugMode) return null
  return <span className="settings-auto-save-badge">Auto-save</span>
}

function useDesktopDebugMode(): boolean {
  const [debugMode, setDebugMode] = React.useState(() =>
    readDesktopBrowserDebugMode(),
  )

  React.useEffect(() => {
    const updateDebugMode = (): void => {
      setDebugMode(readDesktopBrowserDebugMode())
    }

    window.addEventListener(DESKTOP_BROWSER_DEBUG_MODE_EVENT, updateDebugMode)
    window.addEventListener('storage', updateDebugMode)
    return () => {
      window.removeEventListener(
        DESKTOP_BROWSER_DEBUG_MODE_EVENT,
        updateDebugMode,
      )
      window.removeEventListener('storage', updateDebugMode)
    }
  }, [])

  return debugMode
}
