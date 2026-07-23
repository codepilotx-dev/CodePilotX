import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useLocation,
  useNavigate,
  type NavigateFunction,
} from 'react-router-dom'

export const QUICK_CHAT_PATH = '/new'

export type WorkbenchRouteController = {
  navigate: NavigateFunction
  routedSessionId: string | null
  isQuickChatPage: boolean
  isConversationRoute: boolean
  isSettingsRoute: boolean
  settingsActiveTab: string
  handleSettingsTabChange: (tab: string) => void
  handleSettingsBack: () => void
}

export function useWorkbenchRouteController(): WorkbenchRouteController {
  const location = useLocation()
  const navigate = useNavigate()
  const routedSessionId = useMemo(
    () => getRoutedSessionId(location.pathname),
    [location.pathname],
  )
  const isQuickChatPage = location.pathname === QUICK_CHAT_PATH
  const isConversationRoute = routedSessionId !== null
  const isSettingsRoute = location.pathname.startsWith('/settings/')
  const fullLocationPath = `${location.pathname}${location.search}${location.hash}`
  const settingsReturnPathRef = useRef(QUICK_CHAT_PATH)
  const settingsActiveTab =
    /^\/settings\/([^/]+)$/.exec(location.pathname)?.[1] ?? 'general'

  useEffect(() => {
    if (!isSettingsRoute) {
      settingsReturnPathRef.current = fullLocationPath
    }
  }, [fullLocationPath, isSettingsRoute])

  const handleSettingsTabChange = useCallback(
    (tab: string): void => {
      navigate(`/settings/${encodeURIComponent(tab)}`)
    },
    [navigate],
  )

  const handleSettingsBack = useCallback((): void => {
    navigate(settingsReturnPathRef.current || QUICK_CHAT_PATH)
  }, [navigate])

  return {
    navigate,
    routedSessionId,
    isQuickChatPage,
    isConversationRoute,
    isSettingsRoute,
    settingsActiveTab,
    handleSettingsTabChange,
    handleSettingsBack,
  }
}

export function sessionPath(sessionId: string): string {
  return `/threads/${encodeURIComponent(sessionId)}`
}

function getRoutedSessionId(pathname: string): string | null {
  const match = /^\/threads\/([^/]+)$/.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}
