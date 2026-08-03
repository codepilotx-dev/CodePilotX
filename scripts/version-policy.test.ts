/**
 * version-policy.test.ts — 版本策略聚焦测试
 *
 * 运行：bun test scripts/version-policy.test.ts
 */

import { describe, it, expect } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { SEMVER_RE, compareSemver, parseSemver } from "./semver-utils.ts";
import {
  extractArchivedReleaseNotes,
  getChangelogSection,
  parseChangelogSections,
} from "./changelog-utils.ts";
import { buildReleaseNotes } from "./write-release-notes.ts";
import { resolveReleaseDate, runReleasePrCheck } from "./version-policy.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = `bun ${join(ROOT, "scripts", "version-policy.ts")}`;

describe("release date", () => {
  it("uses a locked UTC date so proof trees stay stable across midnight", () => {
    expect(resolveReleaseDate("2026-08-03", new Date("2026-08-04T12:00:00Z")))
      .toBe("2026-08-03");
    expect(resolveReleaseDate(undefined, new Date("2026-08-04T12:00:00Z")))
      .toBe("2026-08-04");
    expect(() => resolveReleaseDate("2026-02-30"))
      .toThrow("有效的 YYYY-MM-DD");
  });
});

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

const FIXTURE_MANIFESTS = [
  "package.json",
  "apps/agent/package.json",
  "apps/desktop/electron/package.json",
  "apps/desktop/renderer/package.json",
] as const;

function fixtureLock(version: string) {
  return `{
  "workspaces": {
    "apps/agent": {
      "name": "@codepilotx/agent",
      "version": "${version}"
    },
    "apps/desktop/electron": {
      "name": "@codepilotx/desktop",
      "version": "${version}"
    },
    "apps/desktop/renderer": {
      "name": "@codepilotx/renderer",
      "version": "${version}"
    }
  }
}
`;
}

function writeFixtureVersion(root: string, version: string) {
  for (const manifest of FIXTURE_MANIFESTS) {
    const fullPath = join(root, manifest);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(
      fullPath,
      `${JSON.stringify({ name: manifest, version }, null, 2)}\n`,
      "utf-8",
    );
  }
  writeFileSync(join(root, "bun.lock"), fixtureLock(version), "utf-8");
}

interface ReleaseFixtureOptions {
  headVersion?: string;
  archivedEntry?: string;
  extraFile?: boolean;
  historicalEntry?: string;
}

function createReleaseFixture(options: ReleaseFixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "codepilotx-version-policy-"));
  const baseVersion = "0.2.0-beta.3";
  const headVersion = options.headVersion ?? "0.2.0-beta.4";
  const unreleasedBody = `### Added

- [desktop] 自动发布下一版 beta`;

  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Version Policy Test"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.email", "version-policy@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });

  writeFixtureVersion(root, baseVersion);
  writeFileSync(
    join(root, "CHANGELOG.md"),
    `# Changelog

## Unreleased

${unreleasedBody}

## ${baseVersion} — 2026-07-29

### Fixed

- [agent] 修复旧问题
`,
    "utf-8",
  );
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "base"], { cwd: root });
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  }).trim();

  writeFixtureVersion(root, headVersion);
  writeFileSync(
    join(root, "CHANGELOG.md"),
    `# Changelog

## Unreleased

## ${headVersion} — 2026-07-30

${options.archivedEntry ?? unreleasedBody}

## ${baseVersion} — 2026-07-29

### Fixed

${options.historicalEntry ?? "- [agent] 修复旧问题"}
`,
    "utf-8",
  );
  if (options.extraFile) {
    writeFileSync(join(root, "unexpected.txt"), "not allowed\n", "utf-8");
  }
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "release"], { cwd: root });

  return {
    root,
    baseSha,
    headVersion,
    headChangelog: readFileSync(join(root, "CHANGELOG.md"), "utf-8"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
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

describe("version:check --release-pr", () => {
  it("accepts an exact beta increment and unchanged archive", () => {
    const fixture = createReleaseFixture();
    try {
      const errors: string[] = [];
      runReleasePrCheck(
        fixture.baseSha,
        fixture.headVersion,
        fixture.headChangelog,
        (...messages) => errors.push(...messages),
        fixture.root,
      );
      expect(errors).toEqual([]);

      const nonemptyErrors: string[] = [];
      const nonemptyUnreleased = fixture.headChangelog.replace(
        "## Unreleased\n\n##",
        "## Unreleased\n\n### Added\n\n- [desktop] 未归档条目\n\n##",
      );
      runReleasePrCheck(
        fixture.baseSha,
        fixture.headVersion,
        nonemptyUnreleased,
        (...messages) => nonemptyErrors.push(...messages),
        fixture.root,
      );
      expect(nonemptyErrors.join("\n")).toContain(
        "head 的 Unreleased 区段必须为空",
      );
    } finally {
      fixture.dispose();
    }
  }, 20_000);

  it("rejects skipping a beta sequence number", () => {
    const fixture = createReleaseFixture({
      headVersion: "0.2.0-beta.5",
    });
    try {
      const errors: string[] = [];
      runReleasePrCheck(
        fixture.baseSha,
        fixture.headVersion,
        fixture.headChangelog,
        (...messages) => errors.push(...messages),
        fixture.root,
      );
      expect(errors.join("\n")).toContain(
        "只能递增同一版本线的一个 beta 序号",
      );
    } finally {
      fixture.dispose();
    }
  }, 20_000);

  it("rejects altered Unreleased content during archival", () => {
    const fixture = createReleaseFixture({
      archivedEntry: `### Added

- [desktop] 被改写的发布说明`,
    });
    try {
      const errors: string[] = [];
      runReleasePrCheck(
        fixture.baseSha,
        fixture.headVersion,
        fixture.headChangelog,
        (...messages) => errors.push(...messages),
        fixture.root,
      );
      expect(errors.join("\n")).toContain("归档内容必须与 base");
    } finally {
      fixture.dispose();
    }
  }, 20_000);

  it("rejects files outside the release allowlist", () => {
    const fixture = createReleaseFixture({ extraFile: true });
    try {
      const errors: string[] = [];
      runReleasePrCheck(
        fixture.baseSha,
        fixture.headVersion,
        fixture.headChangelog,
        (...messages) => errors.push(...messages),
        fixture.root,
      );
      expect(errors.join("\n")).toContain("unexpected.txt");
    } finally {
      fixture.dispose();
    }
  }, 20_000);

  it("rejects unrelated CHANGELOG history edits", () => {
    const fixture = createReleaseFixture({
      historicalEntry: "- [agent] 偷改旧版本记录",
    });
    try {
      const errors: string[] = [];
      runReleasePrCheck(
        fixture.baseSha,
        fixture.headVersion,
        fixture.headChangelog,
        (...messages) => errors.push(...messages),
        fixture.root,
      );
      expect(errors.join("\n")).toContain("不得改写 CHANGELOG 历史");
    } finally {
      fixture.dispose();
    }
  }, 20_000);
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
