import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { RightDockPanelContext, RightDockToolId } from './rightDockTools.js'
import {
  RightDockFilesPanel,
  RightDockPlanPanel,
  RightDockSideChatPanel,
  RightDockTerminalPanel,
} from './RightDockPanels.js'

type ReviewPanelProps = RightDockPanelContext['review'] & { debugMode: boolean }

export type RightDockPanelLoaders = {
  review: () => Promise<{ default: ComponentType<ReviewPanelProps> }>
  browser: () => Promise<{
    default: ComponentType<RightDockPanelContext['browser']>
  }>
  toolProbe: () => Promise<{ default: ComponentType }>
  dialogDebug: () => Promise<{ default: ComponentType }>
  performanceDiagnostics: () => Promise<{ default: ComponentType }>
}

const rightDockPanelLoaders: RightDockPanelLoaders = {
  review: () =>
    import('../review/WorkspaceReviewSidebar.js').then(module => ({
      default: module.WorkspaceReviewSidebar,
    })),
  browser: () =>
    import('../browser/DesktopBrowserPanel.js').then(module => ({
      default: module.DesktopBrowserPanel,
    })),
  toolProbe: () =>
    import('../debug/ToolProbePanel.js').then(module => ({
      default: module.ToolProbePanel,
    })),
  dialogDebug: () =>
    import('../debug/ConfirmationDialogDebug.js').then(module => ({
      default: module.ConfirmationDialogDebug,
    })),
  performanceDiagnostics: () =>
    import('../debug/PerformanceDiagnosticsPanel.js').then(module => ({
      default: module.PerformanceDiagnosticsPanel,
    })),
}

export type RightDockPanelRenderer = (ctx: RightDockPanelContext) => ReactNode

export function createRightDockPanelRenderers(
  loaders: RightDockPanelLoaders = rightDockPanelLoaders,
  fallback: ReactNode = null,
): Record<RightDockToolId, RightDockPanelRenderer> {
  const WorkspaceReviewSidebar = lazy(loaders.review)
  const DesktopBrowserPanel = lazy(loaders.browser)
  const ToolProbePanel = lazy(loaders.toolProbe)
  const ConfirmationDialogDebug = lazy(loaders.dialogDebug)
  const PerformanceDiagnosticsPanel = lazy(loaders.performanceDiagnostics)

  function withSuspense(node: ReactNode): ReactNode {
    return <Suspense fallback={fallback}>{node}</Suspense>
  }

  return {
    review: ctx => withSuspense(
      <WorkspaceReviewSidebar
        {...ctx.review}
        debugMode={ctx.flags.debugMode}
      />,
    ),
    browser: ctx => {
      if (!ctx.browser.state) {
        return (
          <div
            aria-live="polite"
            className="right-dock-empty-state"
            role="status"
          >
            浏览器正在启动...
          </div>
        )
      }
      return withSuspense(
        <DesktopBrowserPanel {...ctx.browser} state={ctx.browser.state} />,
      )
    },
    plan: ctx => <RightDockPlanPanel plan={ctx.plan} />,
    files: ctx => <RightDockFilesPanel {...ctx.files} />,
    sideChat: ctx => <RightDockSideChatPanel {...ctx.sideChat} />,
    terminal: () => <RightDockTerminalPanel />,
    toolProbe: () => withSuspense(<ToolProbePanel />),
    dialogDebug: () => withSuspense(<ConfirmationDialogDebug />),
    performanceDiagnostics: () => withSuspense(<PerformanceDiagnosticsPanel />),
  }
}

export const rightDockPanelRenderers = createRightDockPanelRenderers()
