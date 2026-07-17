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
  id?: string
  size?: 'default' | 'compact'
}

export function SettingsRow({
  title,
  description,
  control,
  autoSave,
  id,
  size = 'default',
}: Props) {
  return (
    <div
      className="settings-row"
      data-size={size}
      id={id}
    >
      <div className="settings-row-info">
        <h4 className="settings-row-title">{title}</h4>
        {description ? (
          <p className="settings-row-desc">{description}</p>
        ) : null}
      </div>
      {control && (
        <div className="settings-row-control">
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
