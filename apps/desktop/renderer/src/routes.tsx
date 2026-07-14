import { createHashRouter, Navigate } from 'react-router-dom'
import { AutomationView } from './features/automation/AutomationView.js'
import { ConversationPage } from './features/session/ConversationPage.js'
import { DesktopLayout } from './features/layout/DesktopLayout.js'
import { PluginsView } from './features/plugins/PluginsView.js'
import { QuickChatView } from './features/session/QuickChatView.js'
import { SearchView } from './features/search/SearchView.js'
import { SettingsLayout } from './features/settings/SettingsLayout.js'

const router = createHashRouter([
  {
    path: '/',
    element: <DesktopLayout />,
    children: [
      { index: true, element: <Navigate to="/quick-chat" replace /> },
      { path: 'quick-chat', element: <QuickChatView /> },
      { path: 'sessions/:sessionId', element: <ConversationPage /> },
      { path: 'search', element: <SearchView /> },
      { path: 'plugins', element: <PluginsView /> },
      { path: 'automation', element: <AutomationView /> },
      { path: 'settings', element: <SettingsLayout /> },
    ],
  },
])

export { router }
