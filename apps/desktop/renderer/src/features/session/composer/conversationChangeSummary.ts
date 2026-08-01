import type { RenderTurnEntry } from "@codepilotx/session-view";

import type { DesktopGitStatus } from "../../../../shared/types.js";
import { syntheticPatchDisplay } from "../timeline/CanonicalItemRenderer.js";

type ConversationChangeSummary = {
  changedFileCount: number;
  additions: number | null;
  deletions: number | null;
};

export function deriveConversationChangeSummary(
  turns: readonly RenderTurnEntry[],
  gitStatus: DesktopGitStatus | null,
): ConversationChangeSummary {
  if (!gitStatus) {
    return { changedFileCount: 0, additions: 0, deletions: 0 };
  }

  const touchedPaths = new Set<string>();
  for (const turn of turns) {
    const patchFiles = turn.patchItems.flatMap(patch => patch.files);
    const files = patchFiles.length > 0
      ? patchFiles
      : syntheticPatchDisplay(turn.processItems)?.files ?? [];
    for (const file of files) {
      touchedPaths.add(normalizePathForCompare(file.path));
    }
  }
  const files = gitStatus.files.filter(file =>
    touchedPaths.has(normalizePathForCompare(file.path))
    || (file.originalPath
      ? touchedPaths.has(normalizePathForCompare(file.originalPath))
      : false));
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    if (file.additions === null || file.deletions === null) {
      return { changedFileCount: files.length, additions: null, deletions: null };
    }
    additions += file.additions;
    deletions += file.deletions;
  }

  return {
    changedFileCount: files.length,
    additions,
    deletions,
  };
}

function normalizePathForCompare(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+|\/+$/gu, "")
    .toLowerCase();
}
