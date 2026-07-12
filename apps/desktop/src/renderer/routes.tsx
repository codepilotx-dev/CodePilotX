import { createHashRouter, Navigate } from 'react-router-dom'
import { DesktopLayout } from './features/layout/DesktopLayout.js'
import { QuickChatView } from './features/session/QuickChatView.js'

const router = createHashRouter([
  {
    path: '/',
    element: <DesktopLayout />,
    children: [
      { index: true, element: <Navigate to="/quick-chat" replace /> },
      { path: 'quick-chat', element: <QuickChatView /> },
      {
        path: 'sessions/:sessionId',
        lazy: () =>
          import('./features/session/ConversationPage.js').then(module => ({
            Component: module.ConversationPage,
          })),
      },
      {
        path: 'search',
        lazy: () =>
          import('./features/search/SearchView.js').then(module => ({
            Component: module.SearchView,
          })),
      },
      {
        path: 'plugins',
        lazy: () =>
          import('./features/plugins/PluginsView.js').then(module => ({
            Component: module.PluginsView,
          })),
      },
      {
        path: 'automation',
        lazy: () =>
          import('./features/automation/AutomationView.js').then(module => ({
            Component: module.AutomationView,
          })),
      },
      {
        path: 'settings',
        lazy: () =>
          import('./features/settings/SettingsLayout.js').then(module => ({
            Component: module.SettingsLayout,
          })),
      },
    ],
  },
])

export { router }
