import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RELEASE_LABEL = "automation:beta-release";
const RELEASE_BRANCH_PREFIX = "automation/release-v";
const RELEASE_BOT_LOGIN = "xiaohai-ouyang";
const REPOSITORY = "codepilotx-dev/CodePilotX";
const RELEASE_PATHS = new Set([
  "CHANGELOG.md",
  "package.json",
  "apps/agent/package.json",
  "apps/desktop/electron/package.json",
  "apps/desktop/renderer/package.json",
  "bun.lock",
]);

type PullRequestEvent = {
  repository?: { full_name?: string };
  pull_request?: {
    user?: { login?: string };
    body?: string | null;
    base?: { ref?: string; sha?: string };
    head?: {
      ref?: string;
      sha?: string;
      repo?: { full_name?: string } | null;
    };
    labels?: Array<{ name?: string }>;
  };
};

function runGit(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(detail || `git ${args[0]} failed`);
  }
  return result.stdout.toString().trim();
}

function setTrusted(value: boolean): void {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(output, `trusted=${value}\n`, "utf8");
}

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
const event = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent;
const pullRequest = event.pull_request;
if (!pullRequest) throw new Error("This policy only accepts pull_request events");

const labels = new Set((pullRequest.labels ?? []).map(label => label.name));
const headRef = pullRequest.head?.ref ?? "";
const looksLikeRelease = labels.has(RELEASE_LABEL)
  || headRef.startsWith(RELEASE_BRANCH_PREFIX);
if (!looksLikeRelease) {
  setTrusted(false);
  process.exit(0);
}

const baseSha = pullRequest.base?.sha?.toLowerCase() ?? "";
const headSha = pullRequest.head?.sha?.toLowerCase() ?? "";
if (event.repository?.full_name !== REPOSITORY
  || pullRequest.head?.repo?.full_name !== REPOSITORY
  || pullRequest.user?.login !== RELEASE_BOT_LOGIN
  || pullRequest.base?.ref !== "main"
  || !labels.has(RELEASE_LABEL)
  || !/^[0-9a-f]{40}$/.test(baseSha)
  || !/^[0-9a-f]{40}$/.test(headSha)) {
  throw new Error("Release PR identity does not match the trusted automation policy");
}

const marker = pullRequest.body?.match(
  /<!-- codepilotx-beta-release\s+base-sha:\s*([0-9a-f]{40})\s+version:\s*([^\s]+)\s+tag:\s*(v[^\s]+)\s+-->/i,
);
if (!marker) throw new Error("Release PR marker is missing or malformed");
const markerBase = marker[1].toLowerCase();
const version = marker[2];
const tag = marker[3];
const expectedRef = `${RELEASE_BRANCH_PREFIX}${version}-${baseSha.slice(0, 7)}`;
if (markerBase !== baseSha
  || tag !== `v${version}`
  || headRef !== expectedRef
  || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
  throw new Error("Release PR marker does not match its immutable base and branch");
}

runGit(["fetch", "--no-tags", "--force", "origin", baseSha, headSha]);
const changedPaths = runGit(["diff", "--name-only", `${baseSha}...${headSha}`])
  .split(/\r?\n/)
  .filter(Boolean);
if (changedPaths.length === 0
  || changedPaths.some(path => !RELEASE_PATHS.has(path))) {
  throw new Error("Release PR changes files outside the release allowlist");
}

const allowedSigners = resolve(
  import.meta.dir,
  "..",
  ".github",
  "release-trust",
  "beta-preflight.allowed_signers",
);
runGit(["config", "gpg.format", "ssh"]);
runGit(["config", "gpg.ssh.allowedSignersFile", allowedSigners]);
runGit(["verify-commit", headSha]);
setTrusted(true);
