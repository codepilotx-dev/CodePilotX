import type { ReactNode } from 'react'
import type { RightDockPanelContext, RightDockToolId } from './rightDockTools.js'
import { DesktopBrowserPanel } from '../browser/DesktopBrowserPanel.js'
import { WorkspaceReviewSidebar } from '../review/WorkspaceReviewSidebar.js'
import { ToolProbePanel } from '../debug/ToolProbePanel.js'
import { ConfirmationDialogDebug } from '../debug/ConfirmationDialogDebug.js'
import { PerformanceDiagnosticsPanel } from '../debug/PerformanceDiagnosticsPanel.js'
import {
  RightDockFilesPanel,
  RightDockPlanPanel,
  RightDockSideChatPanel,
  RightDockTerminalPanel,
} from './RightDockPanels.js'

export type RightDockPanelRenderer = (ctx: RightDockPanelContext) => ReactNode

export const rightDockPanelRenderers: Record<RightDockToolId, RightDockPanelRenderer> = {
  review: ctx => (
    <WorkspaceReviewSidebar
      {...ctx.review}
      debugMode={ctx.flags.debugMode}
    />
  ),
  browser: ctx => <DesktopBrowserPanel {...ctx.browser} />,
  plan: ctx => <RightDockPlanPanel plan={ctx.plan} />,
  files: ctx => <RightDockFilesPanel {...ctx.files} />,
  sideChat: ctx => <RightDockSideChatPanel {...ctx.sideChat} />,
  terminal: () => <RightDockTerminalPanel />,
  toolProbe: () => <ToolProbePanel />,
  dialogDebug: () => <ConfirmationDialogDebug />,
  performanceDiagnostics: () => <PerformanceDiagnosticsPanel />,
}
