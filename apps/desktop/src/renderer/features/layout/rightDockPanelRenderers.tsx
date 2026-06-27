import type { ReactNode } from 'react'
import type { RightDockPanelContext, RightDockToolId } from './rightDockTools.js'
import { DesktopBrowserPanel } from '../browser/DesktopBrowserPanel.js'
import { WorkspaceReviewSidebar } from '../review/WorkspaceReviewSidebar.js'
import { ToolProbePanel } from '../debug/ToolProbePanel.js'
import {
  RightDockFilesPanel,
  RightDockPlanPanel,
  RightDockSideChatPanel,
  RightDockTerminalPanel,
} from './RightDockPanels.js'

export type RightDockPanelRenderer = (ctx: RightDockPanelContext) => ReactNode

export const rightDockPanelRenderers: Record<RightDockToolId, RightDockPanelRenderer> = {
  review: ctx => <WorkspaceReviewSidebar {...ctx.review} />,
  browser: ctx => <DesktopBrowserPanel {...ctx.browser} />,
  plan: ctx => <RightDockPlanPanel plan={ctx.plan} />,
  files: ctx => <RightDockFilesPanel {...ctx.files} />,
  sideChat: () => <RightDockSideChatPanel />,
  terminal: () => <RightDockTerminalPanel />,
  toolProbe: () => <ToolProbePanel />,
}
