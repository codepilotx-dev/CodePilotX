import type { SubagentProjection } from "@codepilotx/shared/thread";
import type { DesktopSessionEvent } from "../../../shared/types.js";
import {
  planTitleFromSummary,
  type OpenPlanInDockRequest,
} from "./WorkflowPlanCard.js";

export type ThreadSummarySource = {
  label: string;
  url: string;
};

export type ThreadSummaryPlan = OpenPlanInDockRequest;

export type ThreadSummarySubagent = {
  id: string;
  name: string;
  status: string;
};

export type ThreadSummaryViewModel = {
  environment: {
    workspacePath: string;
    branchName: string | null;
    changedFileCount: number;
    commitOrPushEnabled: boolean;
    commitOrPushDisabledReason: string | null;
    createPullRequestEnabled: boolean;
    createPullRequestDisabledReason: string | null;
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

export type ThreadSummarySourcePreview = {
  items: ThreadSummarySource[];
  totalCount: number;
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

  return {
    environment: normalizedWorkspacePath
      ? {
          workspacePath: normalizedWorkspacePath,
          branchName: normalizedBranchName,
          changedFileCount,
          commitOrPushEnabled: true,
          commitOrPushDisabledReason: null,
          createPullRequestEnabled: Boolean(normalizedBranchName),
          createPullRequestDisabledReason: normalizedBranchName
            ? null
            : "创建拉取请求前需要先创建或检出 Git 分支",
        }
      : null,
    changes: normalizedWorkspacePath
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
      eventId: event.id,
      title: planTitleFromSummary(content),
      content,
    };
  }
  return null;
}

export function previewThreadSummarySources(
  sources: readonly ThreadSummarySource[],
  limit = 3,
): ThreadSummarySourcePreview {
  const safeLimit = Math.max(0, Math.floor(limit));
  return {
    items: sources.slice(0, safeLimit),
    totalCount: sources.length,
  };
}
