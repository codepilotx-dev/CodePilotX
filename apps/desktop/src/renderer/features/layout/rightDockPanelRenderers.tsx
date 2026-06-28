import type { ReactNode } from "react";
import type {
  RightDockPanelContext,
  RightDockToolId,
} from "./rightDockTools.js";
import { DesktopBrowserPanel } from "../browser/DesktopBrowserPanel.js";
import { WorkspaceReviewSidebar } from "../review/WorkspaceReviewSidebar.js";
import { ToolProbePanel } from "../debug/ToolProbePanel.js";
import {
  RightDockAgentsPanel,
  RightDockCollaborationPanel,
  RightDockFilesPanel,
  RightDockGoalPanel,
  RightDockHooksPanel,
  RightDockPlanPanel,
  RightDockSessionsPanel,
  RightDockSideChatPanel,
  RightDockTerminalPanel,
  RightDockTokenUsagePanel,
} from "./RightDockPanels.js";

export type RightDockPanelRenderer = (ctx: RightDockPanelContext) => ReactNode;

export const rightDockPanelRenderers: Record<
  RightDockToolId,
  RightDockPanelRenderer
> = {
  review: (ctx) => <WorkspaceReviewSidebar {...ctx.review} />,
  browser: (ctx) => <DesktopBrowserPanel {...ctx.browser} />,
  goal: (ctx) => <RightDockGoalPanel {...ctx.goal} />,
  plan: (ctx) => <RightDockPlanPanel plan={ctx.plan} />,
  files: (ctx) => <RightDockFilesPanel {...ctx.files} />,
  sideChat: () => <RightDockSideChatPanel />,
  terminal: (ctx) => <RightDockTerminalPanel {...ctx.terminal} />,
  agents: (ctx) => <RightDockAgentsPanel {...ctx.agents} />,
  hooks: (ctx) => <RightDockHooksPanel {...ctx.hooks} />,
  sessions: (ctx) => <RightDockSessionsPanel {...ctx.sessions} />,
  tokenUsage: (ctx) => <RightDockTokenUsagePanel {...ctx.tokenUsage} />,
  collaboration: (ctx) => (
    <RightDockCollaborationPanel {...ctx.collaboration} />
  ),
  toolProbe: () => <ToolProbePanel />,
};
