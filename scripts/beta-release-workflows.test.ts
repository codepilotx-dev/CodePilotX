import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const prepareWorkflow = readWorkflow("prepare-beta-release.yml");
const finalizeWorkflow = readWorkflow("finalize-beta-release.yml");
const packageWorkflow = readWorkflow("windows-x64-package.yml");
const ciWorkflow = readWorkflow("ci.yml");
const prRulesWorkflow = readWorkflow("pr-rules.yml");
const releasePrPolicy = readFileSync(
  resolve(repositoryRoot, "scripts", "verify-release-pr-policy.ts"),
  "utf8",
);
const betaReleaseScript = readFileSync(
  resolve(repositoryRoot, "scripts", "beta-release.ts"),
  "utf8",
);

function readWorkflow(name: string): string {
  return readFileSync(resolve(repositoryRoot, ".github", "workflows", name), "utf8");
}

function actionReferences(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map(match => match[1]);
}

function job(workflow: string, name: string): string {
  const normalized = workflow.replaceAll("\r\n", "\n");
  const match = normalized.match(new RegExp(
    `^  ${name}:\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|(?![\\s\\S]))`,
    "m",
  ));
  if (!match) throw new Error(`Missing workflow job ${name}`);
  return match[0];
}

describe("beta release workflows", () => {
  test("Prepare is manual-only and requires a signed local proof", () => {
    expect(prepareWorkflow).toMatch(/^on:\s+workflow_dispatch:/m);
    expect(prepareWorkflow).not.toMatch(/^\s{2}(push|schedule):/m);
    for (const input of [
      "main_sha",
      "preflight_digest",
      "preflight_payload",
      "preflight_signature",
    ]) {
      expect(prepareWorkflow).toMatch(
        new RegExp(`${input}:\\s+description:[^\\n]+\\s+required: true\\s+type: string`),
      );
    }
    expect(prepareWorkflow).toContain("github.ref == 'refs/heads/main'");
    expect(prepareWorkflow).toContain("inputs.preflight_digest");
    expect(prepareWorkflow).toContain("--preflight-payload");
    expect(prepareWorkflow).toContain("--preflight-signature");
    expect(prepareWorkflow).not.toContain("BETA_RELEASE_AUTOMATION_ENABLED == 'true'");
  });

  test("live Prepare requires and validates one reusable dry-run receipt", () => {
    expect(prepareWorkflow).toContain('throw "dry_run_id is required for live Prepare"');
    expect(prepareWorkflow).toContain("repos/$env:GITHUB_REPOSITORY/actions/runs/$env:DRY_RUN_ID");
    expect(prepareWorkflow).toContain('$metadata.path -cne ".github/workflows/prepare-beta-release.yml"');
    expect(prepareWorkflow).toContain('$metadata.conclusion -cne "success"');
    expect(prepareWorkflow).toContain("gh run download $env:DRY_RUN_ID");
    expect(prepareWorkflow).toContain("--dry-run-receipt");
    expect(prepareWorkflow).toContain("--dry-run-id");
    expect(job(prepareWorkflow, "prepare")).not.toContain("package:win");
  });

  test("dry-run uploads a proof-bound receipt and live never uploads one", () => {
    expect(prepareWorkflow).toContain("--receipt-output");
    expect(prepareWorkflow).toContain(
      "beta-dry-run-receipt-${{ steps.candidate.outputs.sha }}-${{ steps.candidate.outputs.digest }}",
    );
    expect(prepareWorkflow).toMatch(
      /name: Upload reusable dry-run receipt\s+if: \$\{\{ inputs\.dry_run \}\}/,
    );
    expect(prepareWorkflow).toMatch(
      /run-name:[\s\S]*inputs\.main_sha[\s\S]*inputs\.preflight_digest[\s\S]*inputs\.dry_run_id/,
    );
  });

  test("ordinary pull requests never enter a self-hosted release runner", () => {
    expect(job(packageWorkflow, "release-pr-policy")).toContain("runs-on: windows-latest");
    expect(job(packageWorkflow, "unsigned-smoke")).toContain("runs-on: windows-latest");
    expect(job(packageWorkflow, "unsigned-smoke")).not.toContain("codepilotx-release");
    expect(job(packageWorkflow, "package-release")).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    );
    expect(prepareWorkflow).not.toMatch(/^\s{2}pull_request:/m);
    expect(finalizeWorkflow).not.toMatch(/^\s{2}pull_request:/m);
  });

  test("trusted Release PR fast path is strict and keeps required job names", () => {
    for (const workflow of [ciWorkflow, prRulesWorkflow, packageWorkflow]) {
      expect(workflow).toContain("types: [opened, synchronize, reopened, labeled]");
    }
    expect(ciWorkflow).toContain("release-pr-policy:");
    for (const requiredJob of ["quality", "unit-tests", "dependency-audit"]) {
      const required = job(ciWorkflow, requiredJob);
      expect(required).toContain("needs: release-pr-policy");
      expect(required).toContain("needs.release-pr-policy.outputs.trusted == 'true'");
    }
    expect(job(packageWorkflow, "unsigned-smoke")).toContain("needs: release-pr-policy");
    expect(job(prRulesWorkflow, "changelog-check")).toContain("needs: release-pr-policy");
    expect(job(prRulesWorkflow, "changelog-check")).toContain(
      "needs.release-pr-policy.outputs.trusted == 'true'",
    );
    expect(releasePrPolicy).toContain('const RELEASE_BOT_LOGIN = "xiaohai-ouyang"');
    expect(releasePrPolicy).toContain('const RELEASE_LABEL = "automation:beta-release"');
    expect(releasePrPolicy).toContain("codepilotx-beta-release");
    expect(releasePrPolicy).toContain("RELEASE_PATHS");
    expect(releasePrPolicy).toContain('runGit(["verify-commit", headSha])');
    expect(releasePrPolicy).toContain("beta-preflight.allowed_signers");
  });

  test("tag package is signed on the protected release runner", () => {
    const packageRelease = job(packageWorkflow, "package-release");
    expect(packageRelease).toContain(
      "runs-on: [self-hosted, windows, x64, codepilotx-release]",
    );
    expect(packageRelease).toContain("name: beta-release");
    expect(packageRelease).toContain('CODEPILOTX_REQUIRE_SIGNING: "1"');
    expect(packageRelease).toContain("Verify trusted Release PR identity");
    expect(packageRelease).toContain("git verify-commit $pullRequest.head.sha");
    expect(packageRelease).toContain("scripts/smoke-installed-win-x64.ps1");
    expect(packageRelease).toContain("anchore/sbom-action@");
    expect(packageRelease).toContain("release/SHA256SUMS.txt");
    expect(packageRelease).toContain("release/RELEASE_NOTES.md");
  });

  test("GitHub-hosted publish only attests and publishes the unique artifact", () => {
    const publish = job(packageWorkflow, "publish-release");
    expect(publish).toContain("runs-on: ubuntu-latest");
    expect(publish).toContain("actions/download-artifact@");
    expect(publish).toContain("actions/attest-build-provenance@");
    expect(publish).toContain("actions/attest-sbom@");
    expect(publish).not.toContain("package:win");
    expect(publish).not.toContain("setup-bun");
  });

  test("manual finalize targets one merge SHA and only schedules reconcile", () => {
    expect(finalizeWorkflow).toContain('if ($env:GITHUB_EVENT_NAME -eq "schedule")');
    expect(finalizeWorkflow).toContain('$arguments = @("scripts/beta-release.ts", "reconcile")');
    expect(finalizeWorkflow).toMatch(
      /else \{\s+\$arguments = @\(\s+"scripts\/beta-release\.ts",\s+"finalize",\s+"--main-sha",\s+"\$\{\{ steps\.candidate\.outputs\.sha \}\}"/,
    );
  });

  test("release commits remain detached and temporary worktrees are removed safely", () => {
    expect(betaReleaseScript).not.toContain('git(["switch", "-c", branch]');
    expect(betaReleaseScript).toContain('gitPush(["origin", `HEAD:refs/heads/${branch}`]');
    expect(betaReleaseScript).toContain('"--untracked-files=all"');
    expect(betaReleaseScript).toContain('git(["worktree", "remove", path], ROOT)');
    expect(betaReleaseScript).not.toContain('git(["worktree", "remove", "--force", path]');
  });

  test("Prepare verifies the proof before signing or remote PR side effects", () => {
    const prepareBody = betaReleaseScript.slice(
      betaReleaseScript.indexOf("async function prepare("),
      betaReleaseScript.indexOf("function releasePrChecksPassed"),
    );
    expect(prepareBody.indexOf("verifyBetaPreflightProofInputs(")).toBeGreaterThan(0);
    expect(prepareBody.indexOf("verifyBetaPreflightProofInputs(")).toBeLessThan(
      prepareBody.indexOf("commitPreparedRelease("),
    );
    expect(prepareBody.indexOf("verifyDryRunReceipt(")).toBeLessThan(
      prepareBody.indexOf("closeStaleReleasePullRequests("),
    );
    expect(prepareBody).not.toContain("existsSync(value)");
  });

  test("all actions are pinned to full commit SHAs", () => {
    for (const workflow of [prepareWorkflow, finalizeWorkflow, packageWorkflow, ciWorkflow, prRulesWorkflow]) {
      for (const reference of actionReferences(workflow)) {
        expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      }
    }
  });
});
