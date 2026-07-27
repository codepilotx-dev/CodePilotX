/**
 * version-policy.test.ts — 版本策略聚焦测试
 *
 * 运行：bun test scripts/version-policy.test.ts
 */

import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { SEMVER_RE, compareSemver, parseSemver } from "./semver-utils.ts";
import {
  extractArchivedReleaseNotes,
  getChangelogSection,
  parseChangelogSections,
} from "./changelog-utils.ts";
import { buildReleaseNotes } from "./write-release-notes.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = `bun ${join(ROOT, "scripts", "version-policy.ts")}`;

function runCLI(args: string) {
  try {
    const output = execSync(`${CLI} ${args}`, {
      encoding: "utf-8",
      cwd: ROOT,
      timeout: 15_000,
    });
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (e: any) {
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

/* ───────────── SemVer 工具函数测试 ───────────── */

describe("parseSemver", () => {
  it("accepts 0.2.0-beta.1", () => {
    expect(parseSemver("0.2.0-beta.1")).toEqual({
      major: 0, minor: 2, patch: 0,
      prereleaseType: "beta", prereleaseNum: 1,
    });
  });

  it("accepts 0.3.0-rc.1", () => {
    expect(parseSemver("0.3.0-rc.1")?.prereleaseType).toBe("rc");
  });

  it("accepts 0.3.0-alpha.1", () => {
    expect(parseSemver("0.3.0-alpha.1")?.prereleaseType).toBe("alpha");
  });

  it("accepts stable 0.2.0 (no prerelease)", () => {
    const p = parseSemver("0.2.0");
    expect(p?.prereleaseType).toBeUndefined();
    expect(p?.prereleaseNum).toBeUndefined();
    expect(p?.major).toBe(0);
  });

  it("rejects v prefix", () => {
    expect(parseSemver("v0.2.0")).toBeNull();
  });

  it("rejects alpha without sequence number", () => {
    expect(parseSemver("0.3.0-alpha")).toBeNull();
  });

  it("rejects beta without sequence number", () => {
    expect(parseSemver("0.3.0-beta")).toBeNull();
  });

  it("rejects random text", () => {
    expect(parseSemver("foo")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("beta.2 > beta.1", () => {
    expect(compareSemver("0.2.0-beta.2", "0.2.0-beta.1")).toBe(1);
  });

  it("beta.1 < beta.2", () => {
    expect(compareSemver("0.2.0-beta.1", "0.2.0-beta.2")).toBe(-1);
  });

  it("rc > beta", () => {
    expect(compareSemver("0.2.0-rc.1", "0.2.0-beta.5")).toBe(1);
  });

  it("release > rc", () => {
    expect(compareSemver("0.2.0", "0.2.0-rc.3")).toBe(1);
  });

  it("equal versions return 0", () => {
    expect(compareSemver("0.2.0-beta.1", "0.2.0-beta.1")).toBe(0);
  });

  it("major bump", () => {
    expect(compareSemver("1.0.0", "0.9.0")).toBe(1);
  });

  it("minor bump", () => {
    expect(compareSemver("0.3.0", "0.2.0")).toBe(1);
  });

  it("patch bump", () => {
    expect(compareSemver("0.2.1", "0.2.0")).toBe(1);
  });

  it("rejects same version (not greater)", () => {
    expect(compareSemver("0.2.0-beta.1", "0.2.0-beta.1")).not.toBeGreaterThan(0);
  });
});

/* ───────────── CHANGELOG 发布区段测试 ───────────── */

const RELEASE_CHANGELOG = `# Changelog

## Unreleased

### Added

- [desktop] 尚未发布

## 0.2.0-beta.2 — 2026-07-27

### Added

- [desktop] 新增新特性页面

### Fixed

- [agent] 修复更新日志请求

## 0.2.0-beta.1 — 2026-07-20

### Fixed

- [desktop] 修复旧问题
`;

describe("CHANGELOG release notes", () => {
  it("parses sections and extracts only the requested archived version", () => {
    expect(parseChangelogSections(RELEASE_CHANGELOG).map((item) => item.heading))
      .toEqual([
        "Unreleased",
        "0.2.0-beta.2 — 2026-07-27",
        "0.2.0-beta.1 — 2026-07-20",
      ]);
    expect(getChangelogSection(RELEASE_CHANGELOG, "Unreleased")?.body)
      .toContain("尚未发布");

    const notes = extractArchivedReleaseNotes(
      RELEASE_CHANGELOG,
      "0.2.0-beta.2",
    );
    expect(notes).toContain("新增新特性页面");
    expect(notes).toContain("修复更新日志请求");
    expect(notes).not.toContain("尚未发布");
    expect(notes).not.toContain("修复旧问题");
  });

  it("rejects an unarchived, missing, or empty version", () => {
    expect(() =>
      extractArchivedReleaseNotes(RELEASE_CHANGELOG, "Unreleased")
    ).toThrow("未找到已归档版本");
    expect(() =>
      extractArchivedReleaseNotes(RELEASE_CHANGELOG, "0.2.0-beta.3")
    ).toThrow("未找到已归档版本");
    expect(() =>
      extractArchivedReleaseNotes(
        "## Unreleased\n\n## 0.2.0-beta.2 — 2026-07-27\n\n### Added\n",
        "0.2.0-beta.2",
      )
    ).toThrow("区段为空");
  });

  it("requires the tag, root version, and archived section to agree", () => {
    expect(buildReleaseNotes({
      tag: "v0.2.0-beta.2",
      rootVersion: "0.2.0-beta.2",
      changelogText: RELEASE_CHANGELOG,
    })).toContain("新增新特性页面");

    expect(() => buildReleaseNotes({
      tag: "v0.2.0-beta.2",
      rootVersion: "0.2.0-beta.1",
      changelogText: RELEASE_CHANGELOG,
    })).toThrow("与根版本");
    expect(() => buildReleaseNotes({
      tag: "0.2.0-beta.2",
      rootVersion: "0.2.0-beta.2",
      changelogText: RELEASE_CHANGELOG,
    })).toThrow("必须以");
  });
});

/* ───────────── 集成测试 ───────────── */

describe("version:check (integration)", () => {
  it("passes in a clean repository state", () => {
    const result = runCLI("version:check");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("✅");
  });
});

describe("CHANGELOG.md", () => {
  it("has ## Unreleased section", () => {
    const content = readFileSync(join(ROOT, "CHANGELOG.md"), "utf-8");
    expect(content).toContain("## Unreleased");
  });

  it("has valid categories in Unreleased", () => {
    const content = readFileSync(join(ROOT, "CHANGELOG.md"), "utf-8");
    const unreleasedSection = content.split("## Unreleased")[1] ?? "";
    const versionSection = unreleasedSection.split("\n## ")[0];
    const validCategories = [
      "### Added",
      "### Changed",
      "### Fixed",
      "### Deprecated",
      "### Removed",
      "### Security",
    ];
    for (const line of versionSection.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("### ")) {
        expect(validCategories).toContain(trimmed);
      }
    }
  });
});
