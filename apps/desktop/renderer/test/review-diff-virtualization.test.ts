import { describe, expect, test } from "bun:test";
import {
  countReviewDiffLines,
  shouldVirtualizeReviewFile,
} from "../src/features/review/diff/WorkspaceReviewDiff.js";
import type {
  DesktopReviewDiffFile,
  DesktopReviewDiffLine,
} from "../shared/types.js";

describe("review diff virtualization", () => {
  test("小文件不启用文件内虚拟化", () => {
    const file = reviewFile("src/small.ts", 80);

    expect(countReviewDiffLines([file])).toBe(80);
    expect(shouldVirtualizeReviewFile(file)).toBe(false);
  });

  test("单个文件超过 800 行时启用文件内虚拟化", () => {
    const file = reviewFile("src/large.ts", 801);

    expect(countReviewDiffLines([file])).toBe(801);
    expect(shouldVirtualizeReviewFile(file)).toBe(true);
  });

  test("多个小文件累计超过 800 行不改变各文件判定", () => {
    const files = [
      reviewFile("src/first.ts", 300),
      reviewFile("src/second.ts", 300),
      reviewFile("src/third.ts", 300),
    ];

    expect(countReviewDiffLines(files)).toBe(900);
    expect(files.map(shouldVirtualizeReviewFile)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

function reviewFile(path: string, lineCount: number): DesktopReviewDiffFile {
  return {
    path,
    status: "modified",
    additions: 0,
    deletions: 0,
    isUntracked: false,
    hunks: [
      {
        id: `${path}:hunk`,
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: lineCount,
        newStart: 1,
        newLines: lineCount,
        patch: "",
        lines: Array.from({ length: lineCount }, (_, index) =>
          reviewLine(path, index),
        ),
      },
    ],
  };
}

function reviewLine(path: string, index: number): DesktopReviewDiffLine {
  const lineNumber = index + 1;
  const content = `line ${lineNumber}`;
  return {
    id: `${path}:${lineNumber}`,
    type: "context",
    oldLine: lineNumber,
    newLine: lineNumber,
    content,
    raw: ` ${content}`,
  };
}
