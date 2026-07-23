import { lazy, Suspense, type ReactNode } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { DesktopLayout } from './features/layout/shell/DesktopLayout.js'
import { QuickChatView } from './features/session/QuickChatView.js'
import { NotFoundPage } from './features/routing/NotFoundPage.js'

const AutomationView = lazy(() =>
  import('./features/automation/AutomationView.js').then(module => ({
    default: module.AutomationView,
  })),
)
const ConversationPage = lazy(() =>
  import('./features/session/conversation/ConversationPage.js').then(module => ({
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
const ModelCenterView = lazy(() =>
  import('./features/models/ModelCenterView.js').then(module => ({
    default: module.ModelCenterView,
  })),
)
const SettingsLayout = lazy(() =>
  import('./features/settings/SettingsLayout.js').then(module => ({
    default: module.SettingsLayout,
  })),
)
const LabsPage = lazy(() =>
  import('./features/labs/LabsPage.js').then(module => ({
    default: module.LabsPage,
  })),
)
const PetOverlayPage = lazy(() =>
  import('./features/pet/PetOverlayPage.js').then(module => ({
    default: module.PetOverlayPage,
  })),
)
const PetCatalogPage = lazy(() =>
  import('./features/pet/PetCatalogPage.js').then(module => ({
    default: module.PetCatalogPage,
  })),
)

function deferred(element: ReactNode): ReactNode {
  return <Suspense fallback={null}>{element}</Suspense>
}

const router = createHashRouter([
  {
    path: '/pet-overlay',
    element: deferred(<PetOverlayPage />),
  },
  {
    path: '/',
    element: <DesktopLayout />,
    children: [
      { index: true, element: <Navigate to="/new" replace /> },
      { path: 'new', element: <QuickChatView /> },
      {
        path: 'threads/:threadId',
        element: deferred(<ConversationPage />),
      },
      { path: 'search', element: deferred(<SearchView />) },
      { path: 'models', element: deferred(<ModelCenterView />) },
      { path: 'plugins', element: deferred(<PluginsView />) },
      { path: 'automations', element: deferred(<AutomationView />) },
      { path: 'pets', element: deferred(<PetCatalogPage />) },
      { path: 'settings/:tab', element: deferred(<SettingsLayout />) },
      { path: 'labs', element: deferred(<LabsPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export { router }
