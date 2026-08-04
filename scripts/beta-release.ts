/**
 * beta-release.ts — 受保护 main 分支的自动 Beta 发布编排器。
 *
 * 命令：
 *   bun scripts/beta-release.ts inspect --main-sha <sha> [--json]
 *   bun scripts/beta-release.ts prepare --main-sha <sha> [--quiet-minutes <n>] [--dry-run]
 *   bun scripts/beta-release.ts finalize --main-sha <sha> [--dry-run]
 *   bun scripts/beta-release.ts reconcile [--dry-run]
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getChangelogSection,
  hasChangelogEntry,
} from "./changelog-utils.ts";
import { parseSemver } from "./semver-utils.ts";
import {
  createBetaPreflightProof,
  encodeBetaPreflightProofInputs,
  signBetaPreflightProof,
  verifyBetaPreflightProofInputs,
  type BetaPreflightProofInputsV1,
} from "./beta-preflight-proof.ts";
import {
  createBetaDryRunReceipt,
  validateBetaDryRunReceipt,
  type BetaDryRunReceiptV1,
} from "./beta-dry-run-receipt.ts";
import {
  createReleaseTimingMetrics,
  parseReleaseTimingMetrics,
  warnIfDryRunOverTarget,
  type ReleaseTimingMetricsV1,
} from "./release-timing.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const RELEASE_LABEL = "automation:beta-release";
const FAILURE_LABEL = "release-automation";
const RELEASE_BRANCH_PREFIX = "automation/release-v";
const DEFAULT_BOT_LOGIN = "xiaohai-ouyang";
const PREFLIGHT_SIGNER_IDENTITY = "xouyang525@gmail.com";
const PREFLIGHT_ALLOWED_SIGNERS = join(
  ROOT,
  ".github/release-trust/beta-preflight.allowed_signers",
);
const REQUIRED_PR_CHECKS = new Set([
  "quality",
  "unit-tests",
  "dependency-audit",
  "changelog-check",
  "unsigned-smoke",
  "release-parity",
]);
const RELEASE_PATHS = [
  "CHANGELOG.md",
  "package.json",
  "apps/agent/package.json",
  "apps/desktop/electron/package.json",
  "apps/desktop/renderer/package.json",
  "bun.lock",
] as const;
const TRANSIENT_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 8_000, 20_000] as const;

export type ReleaseStateKind =
  | "idle"
  | "candidate"
  | "prepared"
  | "publishing"
  | "published"
  | "blocked";

export type BetaReleaseState = {
  kind: ReleaseStateKind;
  mainSha: string;
  currentVersion: string;
  currentTag: string;
  nextVersion?: string;
  nextTag?: string;
  reason: string;
  releaseUrl?: string;
  prNumber?: number;
  prMerged?: boolean;
};

export type ReleaseSnapshot = {
  mainSha: string;
  version: string;
  changelogText: string;
  currentTagCommit: string | null;
  currentTagInMain?: boolean;
  currentRelease: GithubRelease | null;
  associatedReleasePr: GithubPullRequest | null;
  openReleasePr?: GithubPullRequest | null;
};

type GithubAsset = {
  name: string;
};

export type GithubRelease = {
  id: number;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url?: string;
  assets: GithubAsset[];
};

type GithubCheck = {
  name?: string;
  status?: string;
  conclusion?: string | null;
};

type GithubPullRequest = {
  number: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  state?: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  user?: { login?: string };
  base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  head?: {
    ref?: string;
    sha?: string;
    repo?: { full_name?: string } | null;
  };
  labels?: Array<{ name?: string }>;
  statusCheckRollup?: GithubCheck[];
};

type GithubWorkflowRun = {
  id: number;
  name?: string;
  path?: string;
  event?: string;
  actor?: { login?: string };
  status: string;
  conclusion: string | null;
  html_url: string;
  run_attempt?: number;
  head_sha?: string;
  head_branch?: string;
};

type PrepareProofInputs = BetaPreflightProofInputsV1 & {
  receiptOutput?: string;
  dryRunId?: string;
  dryRunReceipt?: string;
};

type ReleaseMarker = {
  baseSha: string;
  version: string;
  tag: string;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  allowFailure?: boolean;
  inherit?: boolean;
};

export function nextBetaVersion(version: string): string | null {
  const parsed = parseSemver(version);
  if (
    !parsed
    || parsed.prereleaseType !== "beta"
    || parsed.prereleaseNum === undefined
  ) {
    return null;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-beta.${parsed.prereleaseNum + 1}`;
}

export function releaseBranch(version: string, mainSha: string): string {
  return `${RELEASE_BRANCH_PREFIX}${version}-${mainSha.slice(0, 7)}`;
}

export function buildReleaseMarker(marker: ReleaseMarker): string {
  return [
    "<!-- codepilotx-beta-release",
    `base-sha: ${marker.baseSha}`,
    `version: ${marker.version}`,
    `tag: ${marker.tag}`,
    "-->",
  ].join("\n");
}

export function parseReleaseMarker(body: string | null | undefined): ReleaseMarker | null {
  if (!body) return null;
  const match = body.match(
    /<!-- codepilotx-beta-release\s+base-sha:\s*([0-9a-f]{40})\s+version:\s*([^\s]+)\s+tag:\s*(v[^\s]+)\s+-->/i,
  );
  if (!match) return null;
  return {
    baseSha: match[1].toLowerCase(),
    version: match[2],
    tag: match[3],
  };
}

export function deriveBetaReleaseState(
  snapshot: ReleaseSnapshot,
): BetaReleaseState {
  const currentTag = `v${snapshot.version}`;
  const base = {
    mainSha: snapshot.mainSha,
    currentVersion: snapshot.version,
    currentTag,
  };
  const nextVersion = nextBetaVersion(snapshot.version);
  if (!nextVersion) {
    return {
      ...base,
      kind: "blocked",
      reason: "当前产品版本不是可自动递增的 X.Y.Z-beta.N",
    };
  }

  const releasePr = snapshot.associatedReleasePr;
  const marker = parseReleaseMarker(releasePr?.body);
  const trustedPrepared =
    Boolean(releasePr?.merged_at)
    && releasePr?.merge_commit_sha?.toLowerCase() === snapshot.mainSha.toLowerCase()
    && releasePr?.base?.ref === "main"
    && releasePr?.head?.ref?.startsWith(RELEASE_BRANCH_PREFIX)
    && releasePr?.labels?.some(label => label.name === RELEASE_LABEL)
    && marker?.baseSha.toLowerCase() === releasePr?.base?.sha?.toLowerCase()
    && marker?.version === snapshot.version
    && marker?.tag === currentTag;

  if (!snapshot.currentTagCommit) {
    if (trustedPrepared) {
      return {
        ...base,
        kind: "prepared",
        reason: "Release PR 已合并，等待创建签名标签",
        prNumber: releasePr?.number,
        prMerged: true,
      };
    }
    return {
      ...base,
      kind: "blocked",
      reason: "当前 manifest 版本没有对应标签，且 main 不是可信 Release PR 合并提交",
    };
  }
  if (snapshot.currentTagInMain === false) {
    return {
      ...base,
      kind: "blocked",
      reason: `${currentTag} 未指向指定 main 历史中的提交`,
    };
  }
  if (releaseHasPartialDraftAssets(snapshot.currentRelease)) {
    return {
      ...base,
      kind: "blocked",
      reason: "当前版本的 GitHub Release 草稿已包含部分附件，必须人工检查",
    };
  }
  if (
    snapshot.currentRelease
    && !snapshot.currentRelease.draft
    && !snapshot.currentRelease.prerelease
  ) {
    return {
      ...base,
      kind: "blocked",
      reason: "当前 beta 对应的 GitHub Release 未标记为 prerelease",
    };
  }

  if (snapshot.currentTagCommit.toLowerCase() !== snapshot.mainSha.toLowerCase()) {
    const unreleased = hasUnreleased(snapshot.changelogText);
    if (!snapshot.currentRelease || snapshot.currentRelease.draft) {
      return {
        ...base,
        kind: "publishing",
        reason: "当前版本标签已存在但 Release 尚未发布",
      };
    }
    if (!unreleased) {
      return {
        ...base,
        kind: "idle",
        reason: "当前 main 没有可归档的 Unreleased 内容",
      };
    }
    if (isTrustedOpenReleasePr(snapshot.openReleasePr, snapshot.mainSha, nextVersion)) {
      return {
        ...base,
        kind: "prepared",
        reason: "Release PR 已创建，等待远端必需检查和 auto-merge",
        nextVersion,
        nextTag: `v${nextVersion}`,
        prNumber: snapshot.openReleasePr?.number,
        prMerged: false,
      };
    }
    return {
      ...base,
      kind: "candidate",
      reason: "main 包含新的 Unreleased 内容",
      nextVersion,
      nextTag: `v${nextVersion}`,
    };
  }

  if (!snapshot.currentRelease || snapshot.currentRelease.draft) {
    return {
      ...base,
      kind: "publishing",
      reason: "当前标签已创建，等待 GitHub prerelease 发布",
    };
  }

  if (!hasUnreleased(snapshot.changelogText)) {
    return {
      ...base,
      kind: "published",
      reason: "当前 main 已完成 Beta 发布且没有新的 Unreleased 内容",
      releaseUrl: snapshot.currentRelease.html_url,
    };
  }

  if (isTrustedOpenReleasePr(snapshot.openReleasePr, snapshot.mainSha, nextVersion)) {
    return {
      ...base,
      kind: "prepared",
      reason: "Release PR 已创建，等待远端必需检查和 auto-merge",
      nextVersion,
      nextTag: `v${nextVersion}`,
      prNumber: snapshot.openReleasePr?.number,
      prMerged: false,
    };
  }

  return {
    ...base,
    kind: "candidate",
    reason: "当前版本已发布且 main 包含新的 Unreleased 内容",
    nextVersion,
    nextTag: `v${nextVersion}`,
  };
}

function isTrustedOpenReleasePr(
  pullRequest: GithubPullRequest | null | undefined,
  mainSha: string,
  nextVersion: string,
): boolean {
  const marker = parseReleaseMarker(pullRequest?.body);
  return Boolean(
    pullRequest
    && !pullRequest.merged_at
    && pullRequest.state?.toUpperCase() === "OPEN"
    && pullRequest.base?.ref === "main"
    && pullRequest.head?.ref === releaseBranch(nextVersion, mainSha)
    && pullRequest.labels?.some(label => label.name === RELEASE_LABEL)
    && marker?.baseSha.toLowerCase() === mainSha.toLowerCase()
    && marker?.version === nextVersion
    && marker?.tag === `v${nextVersion}`,
  );
}

export function expectedReleaseAssets(version: string): string[] {
  const installer = `CodePilotX-${version}-x64.exe`;
  return [
    installer,
    `${installer}.blockmap`,
    "beta.yml",
    "SHA256SUMS.txt",
    "codepilotx-windows-x64.spdx.json",
  ].sort();
}

export function validatePublishedRelease(
  release: GithubRelease,
  version: string,
): string | null {
  if (release.draft) return "Release 仍为草稿";
  if (!release.prerelease) return "Beta Release 未标记为 prerelease";
  const actual = release.assets.map(asset => asset.name).sort();
  const expected = expectedReleaseAssets(version);
  const difference = [
    ...expected.filter(name => !actual.includes(name)),
    ...actual.filter(name => !expected.includes(name)),
  ];
  return difference.length === 0
    ? null
    : `Release 附件不完整或包含意外文件：${difference.join(", ")}`;
}

export function resolveTagAction(
  existingCommit: string | null,
  targetCommit: string,
): "create" | "already-created" | "collision" {
  if (!existingCommit) return "create";
  return existingCommit.toLowerCase() === targetCommit.toLowerCase()
    ? "already-created"
    : "collision";
}

export function releaseHasPartialDraftAssets(
  release: GithubRelease | null,
): boolean {
  return Boolean(release?.draft && release.assets.length > 0);
}

function hasUnreleased(changelogText: string): boolean {
  const section = getChangelogSection(changelogText, "Unreleased");
  return Boolean(section && hasChangelogEntry(section));
}

function parseArgs(args: string[]): {
  command: string;
  mainSha?: string;
  quietMinutes: number;
  dryRun: boolean;
  json: boolean;
  preflightDigest?: string;
  preflightPayload?: string;
  preflightSignature?: string;
  receiptOutput?: string;
  dryRunId?: string;
  dryRunReceipt?: string;
} {
  const command = args[0] ?? "";
  const read = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const quietRaw = read("--quiet-minutes") ?? "0";
  const quietMinutes = Number(quietRaw);
  if (!Number.isFinite(quietMinutes) || quietMinutes < 0) {
    throw new Error(`--quiet-minutes 必须是非负数，实际为 "${quietRaw}"`);
  }
  return {
    command,
    mainSha: read("--main-sha"),
    quietMinutes,
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json"),
    preflightDigest: read("--preflight-digest"),
    preflightPayload: read("--preflight-payload"),
    preflightSignature: read("--preflight-signature"),
    receiptOutput: read("--receipt-output"),
    dryRunId: read("--dry-run-id"),
    dryRunReceipt: read("--dry-run-receipt"),
  };
}

async function run(
  executable: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const [command, commandArgs] = executable === "pwsh"
    ? resolvePwshExecution(args)
    : [resolveReleaseExecutable(executable), args];
  const child = Bun.spawn([command, ...commandArgs], {
    cwd: options.cwd ?? ROOT,
    env: cleanEnvironment(options.env),
    stdin: options.inherit ? "inherit" : "ignore",
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    options.inherit ? Promise.resolve("") : new Response(child.stdout).text(),
    options.inherit ? Promise.resolve("") : new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    const detail = sanitizeMessage(stderr.trim() || stdout.trim());
    throw new Error(
      `${executable} ${args[0] ?? ""} 执行失败（code=${exitCode}）${detail ? `：${detail}` : ""}`,
    );
  }
  return { exitCode, stdout, stderr };
}

export function resolveReleaseExecutable(
  executable: string,
  bunExecutable = process.execPath,
): string {
  return executable === "bun" ? bunExecutable : executable;
}

/**
 * 解析 pwsh 执行方式：标准安装目录（GitHub Actions runner 自带）直接用
 * 真实可执行文件；WindowsApps Store 安装的应用执行别名无法被 Bun 直接
 * 启动，回退经 cmd.exe 按用户 PATH 解析执行（cmd 能解析该别名）。
 */
export function resolvePwshExecution(
  args: readonly string[],
): readonly [string, readonly string[]] {
  const standard = join(
    process.env.ProgramFiles ?? "C:\\Program Files",
    "PowerShell/7/pwsh.exe",
  );
  if (existsSync(standard)) return [standard, args];
  const quote = (value: string) =>
    /[ \t"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
  return [
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32/cmd.exe",
    ),
    ["/c", `pwsh ${args.map(quote).join(" ")}`],
  ];
}

function cleanEnvironment(
  additions: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) result[key] = value;
  }
  for (const [key, value] of Object.entries(additions)) {
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}

function sanitizeMessage(message: string): string {
  const token = process.env.RELEASE_BOT_TOKEN;
  const sanitized = token ? message.replaceAll(token, "[REDACTED]") : message;
  return sanitized
    .replace(/[A-Za-z]:\\[^\r\n]+/g, "[LOCAL_PATH]")
    .slice(0, 1_000);
}

async function git(
  args: string[],
  cwd = ROOT,
  options: Omit<CommandOptions, "cwd"> = {},
): Promise<CommandResult> {
  return run("git", args, { ...options, cwd });
}

function botEnvironment(): Record<string, string> {
  const token = process.env.RELEASE_BOT_TOKEN;
  if (!token) {
    throw new Error("缺少 RELEASE_BOT_TOKEN");
  }
  return { GH_TOKEN: token };
}

async function gh(
  args: string[],
  options: Omit<CommandOptions, "env"> = {},
): Promise<CommandResult> {
  return withTransientRetries(
    () => run("gh", args, { ...options, env: botEnvironment() }),
    `gh ${args[0] ?? ""}`,
  );
}

async function gitPush(args: string[], cwd: string): Promise<void> {
  await withTransientRetries(
    async () => {
      await run("git", [
        "-c",
        "credential.helper=!gh auth git-credential",
        "push",
        ...args,
      ], {
        cwd,
        env: botEnvironment(),
        inherit: true,
      });
    },
    "git push",
  );
}

export async function withTransientRetries<T>(
  operation: () => Promise<T>,
  label: string,
  options: {
    attempts?: number;
    delaysMs?: readonly number[];
    sleep?: (milliseconds: number) => Promise<unknown>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? TRANSIENT_ATTEMPTS;
  const delaysMs = options.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? Bun.sleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.warn(`  ⚠ ${label} 暂时失败，将进行第 ${attempt + 1} 次尝试`);
      await sleep(delaysMs[attempt - 1] ?? 0);
    }
  }
  throw lastError;
}

async function repositoryName(): Promise<string> {
  const fromEnvironment = process.env.GITHUB_REPOSITORY;
  if (fromEnvironment) return fromEnvironment;
  const result = await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const value = result.stdout.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("无法确定 GitHub 仓库名称");
  }
  return value;
}

async function apiJson<T>(
  endpoint: string,
  options: { allowNotFound?: boolean } = {},
): Promise<T | null> {
  const request = async () => {
    const result = await run("gh", ["api", endpoint], {
      env: botEnvironment(),
      allowFailure: true,
    });
    if (result.exitCode === 0) return result;
    if (options.allowNotFound && /HTTP 404|Not Found/i.test(result.stderr)) {
      return result;
    }
    throw new Error(`GitHub API 请求失败：${sanitizeMessage(result.stderr)}`);
  };
  const result = await withTransientRetries(request, "GitHub API");
  if (result.exitCode !== 0) {
    if (options.allowNotFound && /HTTP 404|Not Found/i.test(result.stderr)) {
      return null;
    }
    throw new Error(`GitHub API 请求失败：${sanitizeMessage(result.stderr)}`);
  }
  return JSON.parse(result.stdout) as T;
}

async function releases(repository: string): Promise<GithubRelease[]> {
  const result = await gh([
    "api",
    `repos/${repository}/releases?per_page=100`,
    "--paginate",
    "--slurp",
  ]);
  const pages = JSON.parse(result.stdout) as GithubRelease[][];
  return pages.flat();
}

async function releaseForTag(
  repository: string,
  tag: string,
): Promise<GithubRelease | null> {
  return (await releases(repository)).find(item => item.tag_name === tag) ?? null;
}

async function associatedPullRequests(
  repository: string,
  sha: string,
): Promise<GithubPullRequest[]> {
  return (await apiJson<GithubPullRequest[]>(
    `repos/${repository}/commits/${sha}/pulls`,
  )) ?? [];
}

async function openReleasePullRequest(
  repository: string,
  mainSha: string,
  nextVersion: string,
  botLogin: string,
): Promise<GithubPullRequest | null> {
  const pullRequests = (await apiJson<GithubPullRequest[]>(
    `repos/${repository}/pulls?state=open&base=main&per_page=100`,
  )) ?? [];
  return pullRequests.find(pr => {
    const marker = parseReleaseMarker(pr.body);
    return pr.user?.login === botLogin
      && pr.base?.repo?.full_name === repository
      && pr.head?.repo?.full_name === repository
      && pr.head?.ref === releaseBranch(nextVersion, mainSha)
      && pr.labels?.some(label => label.name === RELEASE_LABEL)
      && marker?.baseSha.toLowerCase() === mainSha.toLowerCase()
      && marker?.version === nextVersion
      && marker?.tag === `v${nextVersion}`;
  }) ?? null;
}

function trustedReleasePullRequest(
  pullRequests: GithubPullRequest[],
  repository: string,
  botLogin: string,
): GithubPullRequest | null {
  return pullRequests.find(pr =>
    pr.user?.login === botLogin
    && pr.base?.ref === "main"
    && pr.base?.repo?.full_name === repository
    && pr.head?.repo?.full_name === repository
    && pr.head?.ref?.startsWith(RELEASE_BRANCH_PREFIX)
    && pr.labels?.some(label => label.name === RELEASE_LABEL)
    && Boolean(pr.merged_at)
  ) ?? null;
}

async function inspectRepository(mainSha: string): Promise<BetaReleaseState> {
  const repository = await repositoryName();
  await git(["cat-file", "-e", `${mainSha}^{commit}`]);
  const packageText = (await git(["show", `${mainSha}:package.json`])).stdout;
  const changelogText = (await git(["show", `${mainSha}:CHANGELOG.md`])).stdout;
  const version = (JSON.parse(packageText) as { version?: unknown }).version;
  if (typeof version !== "string") {
    throw new Error("main 的根 package.json 缺少字符串版本");
  }
  const tag = `v${version}`;
  const tagResult = await git(
    ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`],
    ROOT,
    { allowFailure: true },
  );
  const currentTagCommit =
    tagResult.exitCode === 0 ? tagResult.stdout.trim() : null;
  const currentTagInMain = currentTagCommit
    ? (await git([
        "merge-base",
        "--is-ancestor",
        currentTagCommit,
        mainSha,
      ], ROOT, { allowFailure: true })).exitCode === 0
    : undefined;
  const currentRelease = await releaseForTag(repository, tag);
  const prs = await associatedPullRequests(repository, mainSha);
  const botLogin = process.env.RELEASE_BOT_LOGIN ?? DEFAULT_BOT_LOGIN;
  const associatedReleasePr = trustedReleasePullRequest(
    prs,
    repository,
    botLogin,
  );
  const nextVersion = nextBetaVersion(version);
  const openReleasePr = nextVersion
    ? await openReleasePullRequest(repository, mainSha, nextVersion, botLogin)
    : null;
  return deriveBetaReleaseState({
    mainSha,
    version,
    changelogText,
    currentTagCommit,
    currentTagInMain,
    currentRelease,
    associatedReleasePr,
    openReleasePr,
  });
}

async function fetchMainAndTags(): Promise<string> {
  await git([
    "fetch",
    "--no-write-fetch-head",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
    "+refs/tags/*:refs/tags/*",
  ]);
  return (await git(["rev-parse", "origin/main"])).stdout.trim();
}

async function configureSigning(worktree: string): Promise<void> {
  const configuredKey =
    process.env.CODEPILOTX_RELEASE_SIGNING_KEY
    ?? (await git(["config", "--get", "user.signingkey"], worktree, {
      allowFailure: true,
    })).stdout.trim();
  if (!configuredKey) {
    throw new Error("发布机未配置 user.signingkey 或 CODEPILOTX_RELEASE_SIGNING_KEY");
  }
  if (
    configuredKey.includes("/")
    || configuredKey.includes("\\")
  ) {
    const signingPath = resolve(configuredKey);
    if (!existsSync(signingPath)) {
      throw new Error("发布签名密钥不存在");
    }
  }
  await git(["config", "user.name", "Xiao Hi"], worktree);
  await git(["config", "user.email", "xouyang525@gmail.com"], worktree);
  await git(["config", "gpg.format", "ssh"], worktree);
  await git(["config", "user.signingkey", configuredKey], worktree);
  await git(["config", "commit.gpgsign", "true"], worktree);
  await git(["config", "tag.gpgSign", "true"], worktree);
}

async function createTemporaryWorktree(
  sha: string,
): Promise<{ path: string; dispose: () => Promise<void> }> {
  const parent = await mkdtemp(join(tmpdir(), "codepilotx-beta-release-"));
  const path = join(parent, "worktree");
  await git(["worktree", "add", "--detach", path, sha]);
  return {
    path,
    dispose: async () => {
      const safeParent = resolve(parent);
      const tempRoot = resolve(tmpdir());
      const relativeParent = relative(tempRoot, safeParent);
      if (
        relativeParent === ""
        || relativeParent === ".."
        || relativeParent.startsWith(`..${sep}`)
        || resolve(tempRoot, relativeParent) !== safeParent
      ) {
        throw new Error("拒绝清理不属于临时目录的 release worktree");
      }
      const status = (await git([
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ], path)).stdout.trim();
      if (status) {
        throw new Error("release worktree 存在 tracked/untracked 变更，拒绝自动清理");
      }
      await git(["worktree", "remove", path], ROOT);
      await rmdir(parent);
      await git(["worktree", "prune"], ROOT, { allowFailure: true });
    },
  };
}

async function assertReleaseDiff(worktree: string, baseSha: string): Promise<void> {
  const changed = (await git([
    "diff",
    "--name-only",
    `${baseSha}...HEAD`,
  ], worktree)).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  const allowed = [...RELEASE_PATHS].sort();
  const unexpected = changed.filter(path => !allowed.includes(path as typeof RELEASE_PATHS[number]));
  const missing = allowed.filter(path => !changed.includes(path));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Release 提交文件范围无效（unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}）`,
    );
  }
  await git(["diff", "--check", `${baseSha}...HEAD`], worktree);
}

async function prepareReleaseCommit(
  worktree: string,
  mainSha: string,
  version: string,
): Promise<{ headSha: string; releaseTreeSha: string }> {
  const releaseTreeSha = await prepareReleaseTree(worktree, mainSha, version);
  return commitPreparedRelease(worktree, mainSha, version, releaseTreeSha);
}

async function prepareReleaseTree(
  worktree: string,
  mainSha: string,
  version: string,
): Promise<string> {
  const mainCommittedAt = (await git([
    "show",
    "-s",
    "--format=%cI",
    mainSha,
  ], worktree)).stdout.trim();
  const releaseDate = new Date(mainCommittedAt).toISOString().slice(0, 10);
  await run("bun", [
    "scripts/version-policy.ts",
    "version:prepare",
    version,
  ], {
    cwd: worktree,
    inherit: true,
    env: {
      RELEASE_BOT_TOKEN: undefined,
      GH_TOKEN: undefined,
      CODEPILOTX_RELEASE_DATE: releaseDate,
    },
  });
  await run("bun", [
    "scripts/version-policy.ts",
    "version:check",
    "--release-pr",
    "--base",
    mainSha,
  ], {
    cwd: worktree,
    inherit: true,
    env: { RELEASE_BOT_TOKEN: undefined, GH_TOKEN: undefined },
  });
  await git(["add", "--", ...RELEASE_PATHS], worktree);
  const stagedPaths = (await git(["diff", "--cached", "--name-only"], worktree))
    .stdout.split(/\r?\n/).filter(Boolean).sort();
  const allowedPaths = [...RELEASE_PATHS].sort();
  if (JSON.stringify(stagedPaths) !== JSON.stringify(allowedPaths)) {
    throw new Error("Release staged 文件范围与允许列表不一致");
  }
  return (await git(["write-tree"], worktree)).stdout.trim();
}

async function commitPreparedRelease(
  worktree: string,
  mainSha: string,
  version: string,
  expectedTreeSha: string,
): Promise<{ headSha: string; releaseTreeSha: string }> {
  await configureSigning(worktree);
  await git([
    "commit",
    "-S",
    "-m",
    `chore(release)：准备 ${version}`,
  ], worktree, { inherit: true });
  await git([
    "-c",
    `gpg.ssh.allowedSignersFile=${join(worktree, ".github/release-trust/beta-preflight.allowed_signers")}`,
    "verify-commit",
    "HEAD",
  ], worktree);
  await assertReleaseDiff(worktree, mainSha);
  const releaseTreeSha = (await git(["rev-parse", "HEAD^{tree}"], worktree)).stdout.trim();
  if (releaseTreeSha !== expectedTreeSha) {
    throw new Error("签名 Release commit 的 tree 与已验证 tree 不一致");
  }
  return {
    headSha: (await git(["rev-parse", "HEAD"], worktree)).stdout.trim(),
    releaseTreeSha,
  };
}

async function assertCleanReleaseWorktree(worktree: string): Promise<void> {
  const status = (await git([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ], worktree)).stdout.trim();
  if (status) {
    throw new Error("完整验证后 release worktree 出现 tracked/untracked 变更");
  }
}

async function runLocalPreflightSuite(
  worktree: string,
  tag: string,
  baseSha: string,
): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Beta 本地预检只允许 win32-x64");
  }
  if (Bun.version !== "1.3.14") {
    throw new Error(`Beta 本地预检要求 Bun 1.3.14，当前为 ${Bun.version}`);
  }
  const commands: Array<[string, string[], Record<string, string | undefined>?]> = [
    ["bun", ["install", "--frozen-lockfile"]],
    ["bun", ["run", "version:check", "--", "--tag", tag]],
    ["bun", ["run", "typecheck"]],
    ["bun", ["run", "test:unit"]],
    ["bun", ["run", "desktop:css:check"]],
    ["bun", ["run", "security:audit"]],
    ["bun", ["run", "--cwd", "apps/desktop/renderer", "test:a11y"]],
    ["bun", ["run", "package:win"], {
      CODEPILOTX_REQUIRE_SIGNING: "0",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
      CSC_LINK: undefined,
      CSC_KEY_PASSWORD: undefined,
      WIN_CSC_LINK: undefined,
      WIN_CSC_KEY_PASSWORD: undefined,
    }],
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/smoke-installed-win-x64.ps1"]],
  ];
  for (const [command, args, additions] of commands) {
    console.log(`\n▶ ${command} ${args.join(" ")}`);
    await run(command, args, {
      cwd: worktree,
      inherit: true,
      env: {
        RELEASE_BOT_TOKEN: undefined,
        GH_TOKEN: undefined,
        ...additions,
      },
    });
  }
  await assertReleaseDiff(worktree, baseSha);
  await assertCleanReleaseWorktree(worktree);
}

async function runReleaseEnvironmentSuite(
  worktree: string,
  tag: string,
  baseSha: string,
): Promise<ReleaseTimingMetricsV1> {
  const smokeTimingsPath = join(tmpdir(), "release-smoke-timings.json");
  const startedAt = Date.now();
  const commands: Array<[string, string[], Record<string, string | undefined>?]> = [
    ["bun", ["install", "--frozen-lockfile"]],
    ["bun", ["run", "version:check", "--", "--tag", tag]],
    ["bun", ["run", "package:win"], {
      CODEPILOTX_SMOKE_TIMINGS: smokeTimingsPath,
    }],
    ["pwsh", ["-NoLogo", "-NoProfile", "-File", "scripts/smoke-installed-win-x64.ps1"]],
  ];
  let signedPackageMs: number | undefined;
  let installedSmokeMs: number | undefined;
  for (const [command, args, additions] of commands) {
    console.log(`\n▶ ${command} ${args.join(" ")}`);
    const commandStartedAt = Date.now();
    await run(command, args, {
      cwd: worktree,
      inherit: true,
      env: {
        RELEASE_BOT_TOKEN: undefined,
        GH_TOKEN: undefined,
        CODEPILOTX_REQUIRE_SIGNING: "1",
        ...additions,
      },
    });
    const elapsed = Date.now() - commandStartedAt;
    if (command === "bun" && args.includes("package:win")) {
      signedPackageMs = elapsed;
    }
    if (command === "pwsh") {
      installedSmokeMs = elapsed;
    }
  }
  await assertReleaseDiff(worktree, baseSha);
  await assertCleanReleaseWorktree(worktree);
  const metrics = createReleaseTimingMetrics({
    signedPackageMs,
    installedSmokeMs,
    totalMs: Date.now() - startedAt,
  });
  try {
    const smoke = parseReleaseTimingMetrics(
      await readFile(smokeTimingsPath, "utf8"),
    );
    return createReleaseTimingMetrics({
      ...metrics,
      conptyMs: smoke.conptyMs,
      agentReadyMs: smoke.agentReadyMs,
      desktopReadyMs: smoke.desktopReadyMs,
      totalMs: metrics.totalMs,
    });
  } catch {
    // smoke 阶段耗时文件不存在或无效时不阻塞 dry-run。
    return metrics;
  }
}

async function localPreflight(mainSha: string): Promise<BetaReleaseState> {
  const latestMain = await fetchMainAndTags();
  if (latestMain.toLowerCase() !== mainSha.toLowerCase()) {
    throw new Error("--main-sha 不再等于 origin/main，拒绝生成本地证明");
  }
  const state = await inspectRepository(mainSha);
  if (state.kind !== "candidate" || !state.nextVersion || !state.nextTag) {
    throw new Error(`main 当前不是可发布 candidate：${state.reason}`);
  }
  const repository = await repositoryName();
  if (repository !== "codepilotx-dev/CodePilotX") {
    throw new Error("Beta 本地证明只允许 codepilotx-dev/CodePilotX");
  }

  const worktree = await createTemporaryWorktree(mainSha);
  let proofInputs: ReturnType<typeof encodeBetaPreflightProofInputs> | undefined;
  let signedProof: ReturnType<typeof signBetaPreflightProof> | undefined;
  let primaryError: unknown;
  try {
    const releaseCommit = await prepareReleaseCommit(
      worktree.path,
      mainSha,
      state.nextVersion,
    );
    await runLocalPreflightSuite(worktree.path, state.nextTag, mainSha);
    const mainAfterValidation = await fetchMainAndTags();
    if (mainAfterValidation.toLowerCase() !== mainSha.toLowerCase()) {
      throw new Error("本地预检期间 origin/main 已前进，拒绝生成旧候选证明");
    }
    const signingKey = (await git([
      "config",
      "--get",
      "user.signingkey",
    ], ROOT, { allowFailure: true })).stdout.trim();
    if (!signingKey) {
      throw new Error("当前维护者未配置 Git SSH 签名密钥");
    }
    signedProof = signBetaPreflightProof(createBetaPreflightProof({
      mainSha,
      releaseTreeSha: releaseCommit.releaseTreeSha,
      nextVersion: state.nextVersion,
      nextTag: state.nextTag,
    }), { signingKeyFile: signingKey });
    proofInputs = encodeBetaPreflightProofInputs(signedProof);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await worktree.dispose();
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      console.error("本地预检 worktree 清理未完成，已保留原始门禁错误");
    }
  }

  if (!proofInputs || !signedProof) {
    throw new Error("本地预检未生成证明");
  }
  const commonGitDirRaw = (await git(["rev-parse", "--git-common-dir"])).stdout.trim();
  const commonGitDir = resolve(ROOT, commonGitDirRaw);
  const proofDirectory = join(commonGitDir, "codepilotx", "beta-preflight", mainSha);
  await mkdir(proofDirectory, { recursive: true });
  await writeFile(join(proofDirectory, "proof.json"), signedProof.payload, "utf8");
  await writeFile(join(proofDirectory, "proof.json.sig"), signedProof.signature, "utf8");
  await writeFile(
    join(proofDirectory, "workflow-inputs.json"),
    `${JSON.stringify(proofInputs, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    mainSha,
    nextVersion: state.nextVersion,
    nextTag: state.nextTag,
    releaseTreeSha: JSON.parse(signedProof.payload).releaseTreeSha,
    preflightDigest: proofInputs.preflightDigest,
    preflightPayload: proofInputs.preflightPayload,
    preflightSignature: proofInputs.preflightSignature,
  }, null, 2));
  return state;
}

async function verifyDryRunReceipt(
  repository: string,
  proof: PrepareProofInputs,
  expected: {
    mainSha: string;
    releaseTreeSha: string;
    nextVersion: string;
    nextTag: string;
  },
): Promise<BetaDryRunReceiptV1> {
  const runId = Number(proof.dryRunId);
  if (!Number.isSafeInteger(runId) || runId <= 0 || !proof.dryRunReceipt) {
    throw new Error("live Prepare 必须提供有效 --dry-run-id 和 --dry-run-receipt");
  }
  if (String(process.env.GITHUB_RUN_ID ?? "") === String(runId)) {
    throw new Error("live Prepare 不能把当前 run 作为 dry-run 回执来源");
  }
  const metadata = await apiJson<GithubWorkflowRun>(
    `repos/${repository}/actions/runs/${runId}`,
  );
  const trustedActor = process.env.RELEASE_BOT_LOGIN ?? DEFAULT_BOT_LOGIN;
  if (!metadata || metadata.status !== "completed" || metadata.conclusion !== "success" ||
      metadata.event !== "workflow_dispatch" || metadata.head_sha?.toLowerCase() !== expected.mainSha ||
      metadata.actor?.login !== trustedActor ||
      (metadata.path !== ".github/workflows/prepare-beta-release.yml" &&
        metadata.name !== "Prepare beta release")) {
    throw new Error("dry-run Actions run 的 workflow、event、SHA、actor 或结论不受信任");
  }
  const receipt = JSON.parse(await readFile(resolve(proof.dryRunReceipt), "utf8")) as unknown;
  return validateBetaDryRunReceipt(receipt, {
    repository,
    actor: trustedActor,
    runId,
    runAttempt: metadata.run_attempt ?? 1,
    mainSha: expected.mainSha,
    proofDigest: proof.preflightDigest,
    releaseTreeSha: expected.releaseTreeSha,
    nextVersion: expected.nextVersion,
    nextTag: expected.nextTag,
  });
}

async function writeDryRunReceipt(
  repository: string,
  proof: PrepareProofInputs,
  output: string,
  expected: {
    mainSha: string;
    releaseTreeSha: string;
    nextVersion: string;
    nextTag: string;
  },
  timings?: ReleaseTimingMetricsV1,
): Promise<void> {
  const runId = Number(process.env.GITHUB_RUN_ID);
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const actor = process.env.GITHUB_ACTOR ?? "";
  if (!Number.isSafeInteger(runId) || runId <= 0 ||
      !Number.isSafeInteger(runAttempt) || runAttempt <= 0 || !actor) {
    throw new Error("无法从 GitHub Actions 环境生成可信 dry-run 回执");
  }
  const receipt = createBetaDryRunReceipt({
    actor,
    runId,
    runAttempt,
    mainSha: expected.mainSha,
    proofDigest: proof.preflightDigest,
    releaseTreeSha: expected.releaseTreeSha,
    nextVersion: expected.nextVersion,
    nextTag: expected.nextTag,
    timings,
  });
  await writeFile(resolve(output), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

async function ensureRepositoryLabel(
  repository: string,
  name: string,
  color: string,
  description: string,
): Promise<void> {
  const encoded = encodeURIComponent(name);
  const existing = await apiJson(
    `repos/${repository}/labels/${encoded}`,
    { allowNotFound: true },
  );
  if (existing) return;
  await gh([
    "api",
    `repos/${repository}/labels`,
    "--method",
    "POST",
    "-f",
    `name=${name}`,
    "-f",
    `color=${color}`,
    "-f",
    `description=${description}`,
  ]);
}

async function closeStaleReleasePullRequests(
  repository: string,
  mainSha: string,
  dryRun: boolean,
): Promise<void> {
  const result = await gh([
    "pr",
    "list",
    "--repo",
    repository,
    "--state",
    "open",
    "--label",
    RELEASE_LABEL,
    "--json",
    "number,body,headRefName,author",
  ]);
  const pullRequests = JSON.parse(result.stdout) as Array<{
    number: number;
    body?: string | null;
    headRefName?: string;
    author?: { login?: string };
  }>;
  const botLogin = process.env.RELEASE_BOT_LOGIN ?? DEFAULT_BOT_LOGIN;
  for (const pr of pullRequests) {
    const marker = parseReleaseMarker(pr.body);
    const owned =
      pr.author?.login === botLogin
      && pr.headRefName?.startsWith(RELEASE_BRANCH_PREFIX);
    if (!owned || marker?.baseSha === mainSha) continue;
    if (dryRun) {
      console.log(`  [dry-run] 将关闭过期 Release PR #${pr.number}`);
      continue;
    }
    await gh([
      "pr",
      "close",
      String(pr.number),
      "--repo",
      repository,
      "--delete-branch",
      "--comment",
      "main 已前进，此自动 Release PR 已过期；后续任务会从最新 main 重新准备。",
    ]);
  }
}

async function prepare(
  mainSha: string,
  quietMinutes: number,
  dryRun: boolean,
  proof: PrepareProofInputs,
): Promise<BetaReleaseState> {
  if (!proof.preflightDigest || !proof.preflightPayload || !proof.preflightSignature) {
    throw new Error("Prepare 必须提供本地签名预检证明");
  }
  if (dryRun && (!proof.receiptOutput || proof.dryRunId || proof.dryRunReceipt)) {
    throw new Error("dry-run Prepare 必须只提供 --receipt-output");
  }
  if (!dryRun && (!proof.dryRunId || !proof.dryRunReceipt || proof.receiptOutput)) {
    throw new Error("live Prepare 必须提供 dry-run ID 与唯一回执");
  }
  if (quietMinutes > 0) {
    console.log(`等待 main 静默 ${quietMinutes} 分钟…`);
    await Bun.sleep(Math.round(quietMinutes * 60_000));
  }
  const latestMain = await fetchMainAndTags();
  if (latestMain.toLowerCase() !== mainSha.toLowerCase()) {
    return {
      kind: "idle",
      mainSha,
      currentVersion: "unknown",
      currentTag: "unknown",
      reason: `main 已前进到 ${latestMain.slice(0, 12)}，当前候选已被替代`,
    };
  }

  const state = await inspectRepository(mainSha);
  if (state.kind !== "candidate" || !state.nextVersion || !state.nextTag) {
    return state;
  }

  const repository = await repositoryName();
  const branch = releaseBranch(state.nextVersion, mainSha);
  const worktree = await createTemporaryWorktree(mainSha);
  let primaryError: unknown;
  try {
    const releaseTreeSha = await prepareReleaseTree(
      worktree.path,
      mainSha,
      state.nextVersion,
    );
    verifyBetaPreflightProofInputs({
      preflightDigest: proof.preflightDigest,
      preflightPayload: proof.preflightPayload,
      preflightSignature: proof.preflightSignature,
    }, {
      allowedSignersFile: PREFLIGHT_ALLOWED_SIGNERS,
      signerIdentity: PREFLIGHT_SIGNER_IDENTITY,
      expected: {
        mainSha,
        releaseTreeSha,
        nextVersion: state.nextVersion,
        nextTag: state.nextTag,
      },
    });
    const { headSha } = await commitPreparedRelease(
      worktree.path,
      mainSha,
      state.nextVersion,
      releaseTreeSha,
    );
    const marker = buildReleaseMarker({
      baseSha: mainSha,
      version: state.nextVersion,
      tag: state.nextTag,
    });
    if (dryRun) {
      const timings = await runReleaseEnvironmentSuite(
        worktree.path,
        state.nextTag,
        mainSha,
      );
      warnIfDryRunOverTarget(timings.totalMs);
      const mainAfterDryRun = await fetchMainAndTags();
      if (mainAfterDryRun.toLowerCase() !== mainSha.toLowerCase()) {
        throw new Error("环境 dry-run 期间 origin/main 已前进，拒绝生成旧候选回执");
      }
      verifyBetaPreflightProofInputs({
        preflightDigest: proof.preflightDigest,
        preflightPayload: proof.preflightPayload,
        preflightSignature: proof.preflightSignature,
      }, {
        allowedSignersFile: PREFLIGHT_ALLOWED_SIGNERS,
        signerIdentity: PREFLIGHT_SIGNER_IDENTITY,
        expected: {
          mainSha,
          releaseTreeSha,
          nextVersion: state.nextVersion,
          nextTag: state.nextTag,
        },
      });
      await writeDryRunReceipt(repository, proof, proof.receiptOutput!, {
        mainSha,
        releaseTreeSha,
        nextVersion: state.nextVersion,
        nextTag: state.nextTag,
      }, timings);
      console.log(JSON.stringify({
        dryRun: true,
        baseSha: mainSha,
        branch,
        headSha,
        releaseTreeSha,
        proofDigest: proof.preflightDigest,
        version: state.nextVersion,
        tag: state.nextTag,
      }, null, 2));
      return state;
    }

    await verifyDryRunReceipt(repository, proof, {
      mainSha,
      releaseTreeSha,
      nextVersion: state.nextVersion,
      nextTag: state.nextTag,
    });
    await closeStaleReleasePullRequests(repository, mainSha, false);

    const mainAfterValidation = await fetchMainAndTags();
    if (mainAfterValidation.toLowerCase() !== mainSha.toLowerCase()) {
      return {
        ...state,
        kind: "idle",
        reason: `完整验证期间 main 已前进到 ${mainAfterValidation.slice(0, 12)}，放弃旧候选`,
      };
    }

    await ensureRepositoryLabel(
      repository,
      RELEASE_LABEL,
      "1d76db",
      "由受信 Windows release runner 生成的 Beta Release PR",
    );
    await ensureRepositoryLabel(
      repository,
      FAILURE_LABEL,
      "b60205",
      "Beta 发布自动化需要人工处理",
    );
    await gitPush(["origin", `HEAD:refs/heads/${branch}`], worktree.path);
    const body = [
      marker,
      "",
      `自动归档 \`${mainSha.slice(0, 12)}\` 的 Unreleased 内容并准备 \`${state.nextTag}\`。`,
      "",
      "- 本机已完成完整类型检查、测试、无障碍检查、Windows 打包与安装冒烟",
      "- 合并由 main 的必需检查和 GitHub auto-merge 控制",
      "- 请勿向此分支追加人工提交",
    ].join("\n");
    const created = await gh([
      "pr",
      "create",
      "--repo",
      repository,
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `chore(release)：准备 ${state.nextVersion}`,
      "--body",
      body,
      "--label",
      RELEASE_LABEL,
    ]);
    const prUrl = created.stdout.trim();
    if (!/^https:\/\/github\.com\//.test(prUrl)) {
      throw new Error("GitHub 未返回有效的 Release PR URL");
    }
    const mainAfterPullRequest = await fetchMainAndTags();
    if (mainAfterPullRequest.toLowerCase() !== mainSha.toLowerCase()) {
      await gh([
        "pr",
        "close",
        prUrl,
        "--repo",
        repository,
        "--delete-branch",
        "--comment",
        "main 在本机验证后继续前进，此自动 Release PR 已过期；后续任务会从最新 main 重新准备。",
      ]);
      return {
        ...state,
        kind: "idle",
        reason: `创建 PR 时 main 已前进到 ${mainAfterPullRequest.slice(0, 12)}，已关闭旧候选`,
      };
    }
    await gh([
      "pr",
      "merge",
      prUrl,
      "--repo",
      repository,
      "--auto",
      "--merge",
      "--delete-branch",
    ]);
    console.log(`Release PR 已创建并启用 auto-merge：${prUrl}`);
    return state;
  } catch (error) {
    primaryError = error;
    if (!dryRun) {
      await upsertFailureIssue(
        repository,
        state.nextVersion,
        mainSha,
        "prepare",
        error,
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    try {
      await worktree.dispose();
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      console.error("release worktree 清理未完成，已保留原始门禁错误");
    }
  }
}

function releasePrChecksPassed(pr: GithubPullRequest): boolean {
  const checks = pr.statusCheckRollup ?? [];
  return [...REQUIRED_PR_CHECKS].every(required =>
    checks.some(check =>
      check.name === required
      && check.status === "COMPLETED"
      && check.conclusion === "SUCCESS"
    )
  );
}

async function pullRequestDetails(
  repository: string,
  number: number,
): Promise<GithubPullRequest> {
  const result = await gh([
    "pr",
    "view",
    String(number),
    "--repo",
    repository,
    "--json",
    "number,title,body,state,mergedAt,mergeCommit,author,baseRefName,headRefName,headRefOid,labels,statusCheckRollup",
  ]);
  const raw = JSON.parse(result.stdout) as {
    number: number;
    title?: string;
    body?: string | null;
    state?: string;
    mergedAt?: string | null;
    mergeCommit?: { oid?: string } | null;
    author?: { login?: string };
    baseRefName?: string;
    headRefName?: string;
    headRefOid?: string;
    labels?: Array<{ name?: string }>;
    statusCheckRollup?: GithubCheck[];
  };
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state,
    merged_at: raw.mergedAt,
    merge_commit_sha: raw.mergeCommit?.oid,
    user: raw.author,
    base: { ref: raw.baseRefName },
    head: { ref: raw.headRefName, sha: raw.headRefOid },
    labels: raw.labels,
    statusCheckRollup: raw.statusCheckRollup,
  };
}

async function commitIsVerified(
  repository: string,
  sha: string,
): Promise<boolean> {
  const commit = await apiJson<{
    commit?: { verification?: { verified?: boolean } };
  }>(`repos/${repository}/commits/${sha}`);
  return commit?.commit?.verification?.verified === true;
}

async function workflowRunForTag(
  repository: string,
  tag: string,
  sha: string,
): Promise<GithubWorkflowRun | null> {
  const response = await apiJson<{ workflow_runs?: GithubWorkflowRun[] }>(
    `repos/${repository}/actions/workflows/windows-x64-package.yml/runs?event=push&per_page=100`,
  );
  return response?.workflow_runs
    ?.filter(run =>
      run.head_sha?.toLowerCase() === sha.toLowerCase()
      && (!run.head_branch || run.head_branch === tag)
    )
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0] ?? null;
}

async function waitForPublishedRelease(
  repository: string,
  tag: string,
  version: string,
  sha: string,
): Promise<GithubRelease> {
  const timeoutMinutes = Number(
    process.env.CODEPILOTX_RELEASE_PUBLISH_TIMEOUT_MINUTES ?? "75",
  );
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastRerun = "";
  while (Date.now() < deadline) {
    const release = await releaseForTag(repository, tag);
    if (release && !release.draft) {
      const error = validatePublishedRelease(release, version);
      if (error) throw new Error(error);
      return release;
    }
    if (releaseHasPartialDraftAssets(release)) {
      throw new Error("Release 草稿已包含部分附件，拒绝删除或覆盖，必须人工检查");
    }

    const workflowRun = await workflowRunForTag(repository, tag, sha);
    if (
      workflowRun
      && `${workflowRun.id}:${workflowRun.run_attempt ?? 1}` !== lastRerun
      && workflowRun.status === "completed"
      && workflowRun.conclusion !== "success"
    ) {
      const attempt = workflowRun.run_attempt ?? 1;
      if (attempt >= TRANSIENT_ATTEMPTS) {
        throw new Error(`标签发布工作流连续 ${attempt} 次失败：${workflowRun.html_url}`);
      }
      if (release?.draft && release.assets.length > 0) {
        throw new Error("标签工作流失败且草稿已有附件，拒绝自动重跑");
      }
      await gh(["run", "rerun", String(workflowRun.id), "--repo", repository]);
      lastRerun = `${workflowRun.id}:${attempt}`;
    }
    await Bun.sleep(30_000);
  }
  throw new Error(`${tag} 在 ${timeoutMinutes} 分钟内未完成发布`);
}

async function upsertFailureIssue(
  repository: string,
  version: string,
  sha: string,
  phase: string,
  _cause: unknown,
): Promise<void> {
  await ensureRepositoryLabel(
    repository,
    FAILURE_LABEL,
    "b60205",
    "Beta 发布自动化需要人工处理",
  );
  const title = `[release automation] ${version} 发布阻塞`;
  const list = await gh([
    "issue",
    "list",
    "--repo",
    repository,
    "--state",
    "all",
    "--label",
    FAILURE_LABEL,
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title,state",
  ]);
  const issues = JSON.parse(list.stdout) as Array<{
    number: number;
    title: string;
    state: string;
  }>;
  const issue = issues.find(item => item.title === title);
  const runUrl =
    process.env.GITHUB_SERVER_URL
    && process.env.GITHUB_REPOSITORY
    && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "不可用";
  const body = [
    `- 版本：\`${version}\``,
    `- main SHA：\`${sha}\``,
    `- 阶段：\`${phase}\``,
    `- 自动重试上限：${TRANSIENT_ATTEMPTS}`,
    `- Actions：${runUrl}`,
  ].join("\n");
  if (!issue) {
    await gh([
      "issue",
      "create",
      "--repo",
      repository,
      "--title",
      title,
      "--body",
      body,
      "--label",
      FAILURE_LABEL,
    ]);
    return;
  }
  await gh([
    "issue",
    "edit",
    String(issue.number),
    "--repo",
    repository,
    "--body",
    body,
    "--add-label",
    FAILURE_LABEL,
  ]);
  if (issue.state !== "OPEN") {
    await gh([
      "issue",
      "reopen",
      String(issue.number),
      "--repo",
      repository,
    ]);
  }
}

async function closeFailureIssue(
  repository: string,
  version: string,
): Promise<void> {
  const title = `[release automation] ${version} 发布阻塞`;
  const list = await gh([
    "issue",
    "list",
    "--repo",
    repository,
    "--state",
    "open",
    "--label",
    FAILURE_LABEL,
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title",
  ]);
  const issues = JSON.parse(list.stdout) as Array<{
    number: number;
    title: string;
  }>;
  const issue = issues.find(item => item.title === title);
  if (!issue) return;
  await gh([
    "issue",
    "close",
    String(issue.number),
    "--repo",
    repository,
    "--comment",
    `已成功发布 v${version}，自动关闭此故障记录。`,
  ]);
}

async function finalize(
  mainSha: string,
  dryRun: boolean,
): Promise<BetaReleaseState> {
  await fetchMainAndTags();
  const state = await inspectRepository(mainSha);
  if (state.kind === "published") return state;
  if (state.kind === "publishing") {
    if (dryRun) {
      return {
        ...state,
        reason: `${state.reason}（dry-run：不会重跑工作流或修改 Issue）`,
      };
    }
    const repository = await repositoryName();
    try {
      const tagCommit = (await git([
        "rev-parse",
        "--verify",
        `refs/tags/${state.currentTag}^{commit}`,
      ])).stdout.trim();
      const release = await waitForPublishedRelease(
        repository,
        state.currentTag,
        state.currentVersion,
        tagCommit,
      );
      await closeFailureIssue(repository, state.currentVersion);
      return {
        ...state,
        kind: "published",
        reason: "GitHub prerelease 已发布",
        releaseUrl: release.html_url,
      };
    } catch (error) {
      if (!dryRun) {
        await upsertFailureIssue(
          repository,
          state.currentVersion,
          mainSha,
          "publishing",
          error,
        ).catch(() => undefined);
      }
      throw error;
    }
  }
  if (
    state.kind !== "prepared"
    || !state.prNumber
    || state.prMerged === false
  ) return state;

  const repository = await repositoryName();
  try {
    const botLogin = process.env.RELEASE_BOT_LOGIN ?? DEFAULT_BOT_LOGIN;
    const pullRequest = await pullRequestDetails(repository, state.prNumber);
    const marker = parseReleaseMarker(pullRequest.body);
    const expectedBranch = releaseBranch(
      state.currentVersion,
      marker?.baseSha ?? "",
    );
    if (
      pullRequest.user?.login !== botLogin
      || pullRequest.merge_commit_sha?.toLowerCase() !== mainSha.toLowerCase()
      || pullRequest.base?.ref !== "main"
      || pullRequest.head?.ref !== expectedBranch
      || marker?.version !== state.currentVersion
      || marker?.tag !== state.currentTag
      || !pullRequest.labels?.some(label => label.name === RELEASE_LABEL)
      || !releasePrChecksPassed(pullRequest)
    ) {
      throw new Error("Release PR 身份、merge SHA 或必需检查不满足 finalize 条件");
    }
    const headSha = pullRequest.head?.sha;
    if (
      !(await commitIsVerified(repository, mainSha))
      || !headSha
      || !(await commitIsVerified(repository, headSha))
    ) {
      throw new Error("Release PR 提交或 main merge commit 未通过 GitHub 签名验证");
    }
    const ancestor = await git([
      "merge-base",
      "--is-ancestor",
      mainSha,
      "origin/main",
    ], ROOT, { allowFailure: true });
    if (ancestor.exitCode !== 0) {
      throw new Error("Release merge commit 不属于 origin/main 历史");
    }

    const existingTag = await git([
      "rev-parse",
      "--verify",
      `refs/tags/${state.currentTag}^{commit}`,
    ], ROOT, { allowFailure: true });
    const tagAction = resolveTagAction(
      existingTag.exitCode === 0 ? existingTag.stdout.trim() : null,
      mainSha,
    );
    if (tagAction === "collision") {
      throw new Error(`${state.currentTag} 已指向其他提交，拒绝覆盖`);
    }
    if (dryRun) {
      console.log(JSON.stringify({
        dryRun: true,
        action: tagAction,
        tag: state.currentTag,
        target: mainSha,
        pr: state.prNumber,
      }, null, 2));
      return state;
    }

    if (tagAction === "create") {
      await configureSigning(ROOT);
      await git([
        "tag",
        "-s",
        "-a",
        state.currentTag,
        mainSha,
        "-m",
        `chore(release)：发布 ${state.currentTag}`,
      ]);
      await git(["verify-tag", state.currentTag]);
      await gitPush(["origin", `refs/tags/${state.currentTag}`], ROOT);
    }
    const release = await waitForPublishedRelease(
      repository,
      state.currentTag,
      state.currentVersion,
      mainSha,
    );
    await closeFailureIssue(repository, state.currentVersion);
    return {
      ...state,
      kind: "published",
      reason: "签名标签和 GitHub prerelease 均已发布",
      releaseUrl: release.html_url,
    };
  } catch (error) {
    if (!dryRun) {
      await upsertFailureIssue(
        repository,
        state.currentVersion,
        mainSha,
        "finalize",
        error,
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function reconcile(dryRun: boolean): Promise<BetaReleaseState[]> {
  await fetchMainAndTags();
  const repository = await repositoryName();
  const result = await gh([
    "pr",
    "list",
    "--repo",
    repository,
    "--state",
    "merged",
    "--label",
    RELEASE_LABEL,
    "--limit",
    "20",
    "--json",
    "number,mergeCommit",
  ]);
  const pullRequests = JSON.parse(result.stdout) as Array<{
    number: number;
    mergeCommit?: { oid?: string };
  }>;
  const states: BetaReleaseState[] = [];
  for (const pr of pullRequests) {
    const sha = pr.mergeCommit?.oid;
    if (!sha) continue;
    const state = await inspectRepository(sha);
    if (["prepared", "publishing"].includes(state.kind)) {
      states.push(await finalize(sha, dryRun));
    }
  }
  const latestMain = (await git(["rev-parse", "origin/main"])).stdout.trim();
  const latestState = await inspectRepository(latestMain);
  if (latestState.kind === "candidate") {
    if (!states.some(state => state.mainSha === latestMain)) {
      states.push({
        ...latestState,
        kind: "idle",
        reason: "Prepare 需要 24 小时内的本地签名预检证明，自动 reconcile 不创建候选",
      });
    }
  } else if (!states.some(state => state.mainSha === latestMain)) {
    states.push(latestState);
  }
  return states;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!["inspect", "preflight", "prepare", "finalize", "reconcile"].includes(options.command)) {
    throw new Error(
      "用法：beta-release.ts <inspect|preflight|prepare|finalize|reconcile> [--main-sha <sha>] [--quiet-minutes <n>] [--dry-run] [--json]",
    );
  }
  if (
    ["inspect", "preflight", "prepare", "finalize"].includes(options.command)
    && !options.mainSha
  ) {
    throw new Error(`${options.command} 必须提供 --main-sha`);
  }

  let result: BetaReleaseState | BetaReleaseState[];
  switch (options.command) {
    case "inspect":
      await fetchMainAndTags();
      result = await inspectRepository(options.mainSha!);
      break;
    case "preflight":
      result = await localPreflight(options.mainSha!);
      break;
    case "prepare":
      result = await prepare(
        options.mainSha!,
        options.quietMinutes,
        options.dryRun,
        {
          preflightDigest: options.preflightDigest ?? "",
          preflightPayload: options.preflightPayload ?? "",
          preflightSignature: options.preflightSignature ?? "",
          receiptOutput: options.receiptOutput,
          dryRunId: options.dryRunId,
          dryRunReceipt: options.dryRunReceipt,
        },
      );
      break;
    case "finalize":
      result = await finalize(options.mainSha!, options.dryRun);
      break;
    default:
      result = await reconcile(options.dryRun);
      break;
  }
  if (options.json || options.command !== "prepare") {
    console.log(JSON.stringify(result, null, 2));
  }
  const states = Array.isArray(result) ? result : [result];
  if (
    options.command !== "inspect"
    && !options.dryRun
    && states.some(state => state.kind === "blocked")
  ) {
    const repository = await repositoryName();
    for (const state of states.filter(item => item.kind === "blocked")) {
      await upsertFailureIssue(
        repository,
        state.currentVersion,
        state.mainSha,
        options.command,
        new Error(state.reason),
      );
    }
  }
  if (states.some(state => state.kind === "blocked")) process.exitCode = 2;
}

if (import.meta.main) {
  main().catch(error => {
    console.error(`Beta 发布自动化失败：${sanitizeMessage(
      error instanceof Error ? error.message : String(error),
    )}`);
    process.exitCode = 1;
  });
}
