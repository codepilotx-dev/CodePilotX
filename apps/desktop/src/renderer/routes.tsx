import { createHashRouter, Navigate } from 'react-router-dom'
import { AutomationView } from './components/AutomationView.js'
import { ConversationPage } from './components/ConversationPage.js'
import { DesktopLayout } from './components/DesktopLayout.js'
import { PluginsView } from './components/PluginsView.js'
import { QuickChatView } from './components/QuickChatView.js'
import { SearchView } from './components/SearchView.js'
import { SettingsLayout } from './components/SettingsLayout.js'

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
