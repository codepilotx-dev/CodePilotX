import type { SubagentProjection } from "@codepilotx/shared/thread";
import type { DesktopSessionEvent } from "../../../shared/types.js";
import { planTitleFromSummary } from "./WorkflowPlanCard.js";

export type ThreadSummarySource = {
  label: string;
  url: string;
};

export type ThreadSummaryPlan = {
  title: string;
  content: string;
};

export type ThreadSummarySubagent = {
  id: string;
  name: string;
  status: string;
};

export type ThreadSummaryViewModel = {
  environment: {
    workspacePath: string;
    workspaceName: string;
    branchName: string | null;
    changedFileCount: number;
  } | null;
  changes: {
    fileCount: number;
    additions: number;
    deletions: number;
  } | null;
  plan: ThreadSummaryPlan | null;
  sources: ThreadSummarySource[];
  subagents: ThreadSummarySubagent[];
};

export type VisibleThreadSummarySources = {
  items: ThreadSummarySource[];
  canExpand: boolean;
  hiddenCount: number;
};

export function deriveThreadSummaryViewModel({
  additions,
  branchName,
  changedFileCount,
  deletions,
  events,
  sources,
  subagents,
  workspacePath,
}: {
  additions: number;
  branchName: string | null;
  changedFileCount: number;
  deletions: number;
  events: readonly DesktopSessionEvent[];
  sources: readonly ThreadSummarySource[];
  subagents: readonly SubagentProjection[];
  workspacePath: string | null;
}): ThreadSummaryViewModel {
  const normalizedWorkspacePath = workspacePath?.trim() || null;
  const normalizedBranchName = branchName?.trim() || null;
  const hasChanges =
    changedFileCount > 0 || additions > 0 || deletions > 0;

  return {
    environment: normalizedWorkspacePath
      ? {
          workspacePath: normalizedWorkspacePath,
          workspaceName: workspaceNameFromPath(normalizedWorkspacePath),
          branchName: normalizedBranchName,
          changedFileCount,
        }
      : null,
    changes: hasChanges
      ? {
          fileCount: changedFileCount,
          additions,
          deletions,
        }
      : null,
    plan: findLatestThreadSummaryPlan(events),
    sources: [...sources],
    subagents: subagents.map(({ task, currentRun }) => ({
      id: task.id,
      name: task.displayName,
      status: currentRun?.status ?? "interrupted",
    })),
  };
}

export function findLatestThreadSummaryPlan(
  events: readonly DesktopSessionEvent[],
): ThreadSummaryPlan | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "proposed_plan") continue;
    const content =
      typeof event.content === "string" ? event.content.trim() : "";
    if (!content) continue;
    return {
      title: planTitleFromSummary(content),
      content,
    };
  }
  return null;
}

export function visibleThreadSummarySources(
  sources: readonly ThreadSummarySource[],
  expanded: boolean,
  limit = 5,
): VisibleThreadSummarySources {
  const safeLimit = Math.max(0, Math.floor(limit));
  return {
    items: expanded ? [...sources] : sources.slice(0, safeLimit),
    canExpand: sources.length > safeLimit,
    hiddenCount: Math.max(0, sources.length - safeLimit),
  };
}

function workspaceNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized;
}
