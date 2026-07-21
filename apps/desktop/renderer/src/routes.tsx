import { lazy, Suspense, type ReactNode } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { DesktopLayout } from './features/layout/DesktopLayout.js'
import { QuickChatView } from './features/session/QuickChatView.js'

const AutomationView = lazy(() =>
  import('./features/automation/AutomationView.js').then(module => ({
    default: module.AutomationView,
  })),
)
const ConversationPage = lazy(() =>
  import('./features/session/ConversationPage.js').then(module => ({
    default: module.ConversationPage,
  })),
)
const PluginsView = lazy(() =>
  import('./features/plugins/PluginsView.js').then(module => ({
    default: module.PluginsView,
  })),
)
const SearchView = lazy(() =>
  import('./features/search/SearchView.js').then(module => ({
    default: module.SearchView,
  })),
)
const SettingsLayout = lazy(() =>
  import('./features/settings/SettingsLayout.js').then(module => ({
    default: module.SettingsLayout,
  })),
)

function deferred(element: ReactNode): ReactNode {
  return <Suspense fallback={null}>{element}</Suspense>
}

const router = createHashRouter([
  {
    path: '/',
    element: <DesktopLayout />,
    children: [
      { index: true, element: <Navigate to="/quick-chat" replace /> },
      { path: 'quick-chat', element: <QuickChatView /> },
      {
        path: 'sessions/:sessionId',
        element: deferred(<ConversationPage />),
      },
      { path: 'search', element: deferred(<SearchView />) },
      { path: 'plugins', element: deferred(<PluginsView />) },
      { path: 'automation', element: deferred(<AutomationView />) },
      { path: 'settings', element: deferred(<SettingsLayout />) },
    ],
  },
])

export { router }
