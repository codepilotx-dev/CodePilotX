import { lazy, Suspense, type ReactNode } from 'react'
import { createHashRouter, Navigate, useLocation } from 'react-router-dom'
import { FullScreenWhaleLoading } from './components/ui/FullScreenWhaleLoading.js'
import { DesktopSettingsProvider } from './features/settings/useDesktopSettings.js'
import { DesktopLayout } from './features/layout/shell/DesktopLayout.js'
import { QuickChatView } from './features/session/QuickChatView.js'
import { NotFoundPage } from './features/routing/NotFoundPage.js'
import { RouteErrorPage } from './features/routing/RouteErrorPage.js'
import { RequireConfiguredModel } from './features/models/setup/RequireConfiguredModel.js'
import { AutomationView } from './features/automation/AutomationView.js'
import { ConversationPage } from './features/session/conversation/ConversationPage.js'
import { PluginsView } from './features/plugins/PluginsView.js'
import { ProjectsView } from './features/projects/ProjectsView.js'
import { PullRequestsPlaceholder } from './features/pull-requests/PullRequestsPlaceholder.js'
import { ModelSetupPage } from './features/models/setup/ModelSetupPage.js'
import { SettingsLayout } from './features/settings/SettingsLayout.js'
import { PetCatalogPage } from './features/pet/PetCatalogPage.js'
import { legacyModelCenterSettingsTarget } from './features/models/modelCenterState.js'

const PetOverlayPage = lazy(() =>
  import('./features/pet/PetOverlayPage.js').then(module => ({
    default: module.PetOverlayPage,
  })),
)

const SessionGroupsView = lazy(() =>
  import('./features/session-groups/SessionGroupsView.js').then(module => ({
    default: module.SessionGroupsView,
  })),
)

function SessionGroupsRoute(): ReactNode {
  return (
    <Suspense
      fallback={(
        <FullScreenWhaleLoading
          label="正在加载会话组…"
          variant="contained"
        />
      )}
    >
      <SessionGroupsView />
    </Suspense>
  )
}

function LegacyModelsRedirect(): ReactNode {
  const location = useLocation()
  return (
    <Navigate
      replace
      to={legacyModelCenterSettingsTarget(location.search)}
    />
  )
}

const routeErrorElement = <RouteErrorPage />

const router = createHashRouter([
  {
    path: '/pet-overlay',
    errorElement: routeErrorElement,
    element: (
      <DesktopSettingsProvider access="read-only">
        <Suspense fallback={null}>
          <PetOverlayPage />
        </Suspense>
      </DesktopSettingsProvider>
    ),
  },
  {
    path: '/setup',
    errorElement: routeErrorElement,
    element: (
      <DesktopSettingsProvider access="read-write">
        <ModelSetupPage />
      </DesktopSettingsProvider>
    ),
  },
  {
    path: '/',
    errorElement: routeErrorElement,
    element: (
      <DesktopSettingsProvider access="read-write">
        <RequireConfiguredModel />
      </DesktopSettingsProvider>
    ),
    children: [
      {
        element: <DesktopLayout />,
        children: [
          { index: true, element: <Navigate to="/new" replace /> },
          { path: 'new', element: <QuickChatView /> },
          { path: 'threads/:threadId', element: <ConversationPage /> },
          { path: 'projects', element: <ProjectsView /> },
          { path: 'projects/:projectId', element: <ProjectsView /> },
          { path: 'session-groups', element: <SessionGroupsRoute /> },
          { path: 'session-groups/:groupId', element: <SessionGroupsRoute /> },
          { path: 'models', element: <LegacyModelsRedirect /> },
          { path: 'plugins', element: <PluginsView /> },
          { path: 'pull-requests', element: <PullRequestsPlaceholder /> },
          { path: 'automations', element: <AutomationView /> },
          { path: 'pets', element: <PetCatalogPage /> },
          {
            path: 'settings/environment/:projectId',
            element: <SettingsLayout />,
          },
          { path: 'settings/:tab', element: <SettingsLayout /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])

export { router }
