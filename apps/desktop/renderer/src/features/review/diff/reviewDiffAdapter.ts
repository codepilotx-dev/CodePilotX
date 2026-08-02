import type {
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
} from "../../../../shared/types.js";

export type UnifiedDiffHunk = {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  patch: string;
};

export function unifiedPatchToDesktopHunks(
  patch: string,
  hunks: readonly UnifiedDiffHunk[],
): DesktopReviewDiffHunk[] {
  const parsedByHeader = parsePatchLines(patch);
  return hunks.map((hunk, index) => {
    const parsed = parsedByHeader[index];
    return {
      ...hunk,
      lines: parsed?.lines ?? [],
    };
  });
}

function parsePatchLines(
  patch: string,
): Array<{ header: string; lines: DesktopReviewDiffLine[] }> {
  const result: Array<{ header: string; lines: DesktopReviewDiffLine[] }> = [];
  let current: { header: string; lines: DesktopReviewDiffLine[] } | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split(/\r?\n/u)) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      current = { header: raw, lines: [] };
      result.push(current);
      continue;
    }
    if (!current || raw.startsWith("\\ No newline")) continue;
    const prefix = raw[0];
    if (prefix !== " " && prefix !== "+" && prefix !== "-") continue;
    const type =
      prefix === "+" ? "added" : prefix === "-" ? "removed" : "context";
    current.lines.push({
      id: `${result.length}:${current.lines.length}`,
      type,
      oldLine: prefix === "+" ? null : oldLine,
      newLine: prefix === "-" ? null : newLine,
      content: raw.slice(1),
      raw,
    });
    if (prefix !== "+") oldLine += 1;
    if (prefix !== "-") newLine += 1;
  }
  return result;
}
