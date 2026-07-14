import { createHashRouter, Navigate } from 'react-router-dom'
import { StaticAutomationView } from './static/pages/StaticAutomationView'
import { StaticConversationPage } from './static/pages/StaticConversationPage'
import { StaticDesktopLayout } from './static/StaticDesktopLayout'
import { StaticPluginsView } from './static/pages/StaticPluginsView'
import { StaticQuickChatView } from './static/pages/StaticQuickChatView'
import { StaticSearchView } from './static/pages/StaticSearchView'
import { StaticSettingsLayout } from './static/pages/StaticSettingsLayout'

export const router = createHashRouter([
  {
    path: '/',
    element: <StaticDesktopLayout />,
    children: [
      { index: true, element: <Navigate to="/quick-chat" replace /> },
      { path: 'quick-chat', element: <StaticQuickChatView /> },
      { path: 'sessions/:sessionId', element: <StaticConversationPage /> },
      { path: 'search', element: <StaticSearchView /> },
      { path: 'plugins', element: <StaticPluginsView /> },
      { path: 'automation', element: <StaticAutomationView /> },
      { path: 'settings', element: <StaticSettingsLayout /> },
    ],
  },
])
