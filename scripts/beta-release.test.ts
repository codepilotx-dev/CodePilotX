/**
 * beta-release.test.ts — Beta 发布状态机与幂等边界测试
 */

import { describe, expect, it } from "bun:test";
import {
  buildReleaseMarker,
  deriveBetaReleaseState,
  expectedReleaseAssets,
  nextBetaVersion,
  parseReleaseMarker,
  releaseBranch,
  releaseHasPartialDraftAssets,
  resolvePwshExecution,
  resolveReleaseExecutable,
  resolveTagAction,
  validatePublishedRelease,
  withTransientRetries,
  type ReleaseSnapshot,
} from "./beta-release.ts";

const MAIN_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

function snapshot(
  overrides: Partial<ReleaseSnapshot> = {},
): ReleaseSnapshot {
  return {
    mainSha: MAIN_SHA,
    version: "1.2.3-beta.3",
    changelogText: [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "### Added",
      "",
      "- [desktop] 新能力",
    ].join("\n"),
    currentTagCommit: BASE_SHA,
    currentRelease: {
      id: 1,
      tag_name: "v1.2.3-beta.3",
      draft: false,
      prerelease: true,
      assets: expectedReleaseAssets("1.2.3-beta.3").map(name => ({ name })),
    },
    associatedReleasePr: null,
    ...overrides,
  };
}

describe("beta 版本与可信标记", () => {
  it("在 Windows shim 环境中复用当前 Bun 可执行文件", () => {
    expect(resolveReleaseExecutable("bun", "C:/tools/bun.exe"))
      .toBe("C:/tools/bun.exe");
    expect(resolveReleaseExecutable("git", "C:/tools/bun.exe")).toBe("git");
  });

  it("pwsh 无标准安装时经 cmd.exe 按用户 PATH 解析执行", () => {
    const [executable, args] = resolvePwshExecution([
      "-NoLogo",
      "-File",
      "scripts/smoke-installed-win-x64.ps1",
    ]);
    if (executable.toLowerCase().endsWith("pwsh.exe")) {
      expect(args).toEqual(["-NoLogo", "-File", "scripts/smoke-installed-win-x64.ps1"]);
    } else {
      expect(executable.toLowerCase()).toMatch(/cmd\.exe$/);
      expect(args[0]).toBe("/c");
      expect(args[1]).toMatch(/^pwsh -NoLogo -File scripts\/smoke-installed-win-x64\.ps1$/);
    }
  });

  it("只递增同一版本线的 beta 序号", () => {
    expect(nextBetaVersion("1.2.3-beta.3")).toBe("1.2.3-beta.4");
    expect(nextBetaVersion("1.2.3-rc.1")).toBeNull();
    expect(nextBetaVersion("1.2.3")).toBeNull();
  });

  it("生成稳定的自动发布分支和机器可读标记", () => {
    const marker = {
      baseSha: BASE_SHA,
      version: "1.2.3-beta.4",
      tag: "v1.2.3-beta.4",
    };
    expect(releaseBranch(marker.version, BASE_SHA))
      .toBe(`automation/release-v1.2.3-beta.4-${BASE_SHA.slice(0, 7)}`);
    expect(parseReleaseMarker(buildReleaseMarker(marker))).toEqual(marker);
  });
});

describe("发布状态机", () => {
  it("已发布当前 beta 且 Unreleased 非空时产生下一版候选", () => {
    expect(deriveBetaReleaseState(snapshot())).toMatchObject({
      kind: "candidate",
      nextVersion: "1.2.3-beta.4",
      nextTag: "v1.2.3-beta.4",
    });
  });

  it("允许从缺少新附件规范的历史 prerelease 继续升版", () => {
    expect(deriveBetaReleaseState(snapshot({
      currentRelease: {
        id: 1,
        tag_name: "v1.2.3-beta.3",
        draft: false,
        prerelease: true,
        assets: [{ name: "CodePilotX-1.2.3-beta.3-x64.exe" }],
      },
    })).kind).toBe("candidate");
  });

  it("Unreleased 为空时保持 idle", () => {
    const state = deriveBetaReleaseState(snapshot({
      changelogText: "# Changelog\n\n## Unreleased\n",
    }));
    expect(state.kind).toBe("idle");
  });

  it("非 beta 版本停止自动化", () => {
    expect(deriveBetaReleaseState(snapshot({
      version: "1.2.3",
      currentTagCommit: MAIN_SHA,
    })).kind).toBe("blocked");
  });

  it("当前标签存在但 prerelease 未发布时优先恢复", () => {
    expect(deriveBetaReleaseState(snapshot({
      currentRelease: null,
    }))).toMatchObject({
      kind: "publishing",
      currentVersion: "1.2.3-beta.3",
    });
  });

  it("仅接受 base、分支、标签和标记一致的已合并 Release PR", () => {
    const body = buildReleaseMarker({
      baseSha: BASE_SHA,
      version: "1.2.3-beta.3",
      tag: "v1.2.3-beta.3",
    });
    const state = deriveBetaReleaseState(snapshot({
      currentTagCommit: null,
      associatedReleasePr: {
        number: 42,
        merged_at: "2026-07-30T00:00:00Z",
        merge_commit_sha: MAIN_SHA,
        body,
        base: { ref: "main", sha: BASE_SHA },
        head: {
          ref: `automation/release-v1.2.3-beta.3-${BASE_SHA.slice(0, 7)}`,
        },
        labels: [{ name: "automation:beta-release" }],
      },
    }));
    expect(state).toMatchObject({ kind: "prepared", prNumber: 42 });
  });

  it("同一 base 已有开放 Release PR 时不重复准备", () => {
    const nextVersion = "1.2.3-beta.4";
    const state = deriveBetaReleaseState(snapshot({
      openReleasePr: {
        number: 43,
        state: "open",
        body: buildReleaseMarker({
          baseSha: MAIN_SHA,
          version: nextVersion,
          tag: `v${nextVersion}`,
        }),
        base: { ref: "main" },
        head: { ref: releaseBranch(nextVersion, MAIN_SHA) },
        labels: [{ name: "automation:beta-release" }],
      },
    }));
    expect(state).toMatchObject({
      kind: "prepared",
      prNumber: 43,
      prMerged: false,
    });
  });
});

describe("标签、附件与重试幂等", () => {
  it("同名标签只在同 SHA 时视为幂等成功", () => {
    expect(resolveTagAction(null, MAIN_SHA)).toBe("create");
    expect(resolveTagAction(MAIN_SHA.toUpperCase(), MAIN_SHA))
      .toBe("already-created");
    expect(resolveTagAction(BASE_SHA, MAIN_SHA)).toBe("collision");
  });

  it("要求发布包含精确的五类产物", () => {
    const version = "1.2.3-beta.4";
    const complete = {
      id: 2,
      tag_name: `v${version}`,
      draft: false,
      prerelease: true,
      assets: expectedReleaseAssets(version).map(name => ({ name })),
    };
    expect(validatePublishedRelease(complete, version)).toBeNull();
    expect(validatePublishedRelease({
      ...complete,
      assets: complete.assets.slice(1),
    }, version)).toContain("附件");
  });

  it("部分草稿附件必须进入人工处理", () => {
    expect(releaseHasPartialDraftAssets({
      id: 3,
      tag_name: "v1.2.3-beta.4",
      draft: true,
      prerelease: true,
      assets: [{ name: "beta.yml" }],
    })).toBeTrue();
  });

  it("瞬时失败最多尝试三次后终止", async () => {
    let attempts = 0;
    await expect(withTransientRetries(
      async () => {
        attempts += 1;
        throw new Error("network");
      },
      "test",
      { attempts: 3, delaysMs: [0, 0], sleep: async () => undefined },
    )).rejects.toThrow("network");
    expect(attempts).toBe(3);
  });
});
