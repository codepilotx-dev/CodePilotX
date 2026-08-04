import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const prepareWorkflow = readWorkflow("prepare-beta-release.yml");
const finalizeWorkflow = readWorkflow("finalize-beta-release.yml");
const packageWorkflow = readWorkflow("windows-x64-package.yml");
const ciWorkflow = readWorkflow("ci.yml");
const prRulesWorkflow = readWorkflow("pr-rules.yml");
const canaryWorkflow = readWorkflow("release-runner-canary.yml").replaceAll("\r\n", "\n");
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
    expect(job(packageWorkflow, "release-parity")).toContain("runs-on: windows-latest");
    expect(job(packageWorkflow, "release-parity")).not.toContain("codepilotx-release");
    expect(job(packageWorkflow, "package-release")).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    );
    expect(prepareWorkflow).not.toMatch(/^\s{2}pull_request:/m);
    expect(finalizeWorkflow).not.toMatch(/^\s{2}pull_request:/m);
    expect(canaryWorkflow).not.toMatch(/pull_request:/m);
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
    expect(betaReleaseScript).toContain('"release-parity"');
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

  test("Prepare 与 Finalize 共享 release-state 并发组且不取消进行中的工作", () => {
    for (const workflow of [prepareWorkflow, finalizeWorkflow]) {
      expect(workflow).toContain("group: release-state-${{ github.repository }}");
      expect(workflow).toContain("cancel-in-progress: false");
    }
    expect(packageWorkflow).not.toContain("release-state-${{ github.repository }}");
  });

  test("每个 self-hosted 发布 job 都创建并清理唯一运行上下文", () => {
    for (const workflow of [prepareWorkflow, finalizeWorkflow]) {
      expect(workflow).toContain("bun scripts/release-run-context.ts create");
      expect(workflow).toContain("bun scripts/release-run-context.ts dispose");
      expect(workflow).toContain("if: always() && steps.run-context.outputs.created == 'true'");
    }
    const packageRelease = job(packageWorkflow, "package-release");
    expect(packageRelease).toContain("bun scripts/release-run-context.ts create");
    expect(packageRelease).toContain("bun scripts/release-run-context.ts dispose");
    expect(packageRelease).toContain("if: always() && steps.run-context.outputs.created == 'true'");
    expect(job(canaryWorkflow, "canary")).toContain("bun scripts/release-run-context.ts create");
    expect(job(canaryWorkflow, "canary")).toContain("bun scripts/release-run-context.ts dispose");
    expect(job(prepareWorkflow, "prepare")).not.toContain("TEMP: ${{ runner.temp }}");
    expect(job(finalizeWorkflow, "finalize")).not.toContain("TEMP: ${{ runner.temp }}");
  });

  test("release-parity 只使用合成签名且可信 Release PR 走同一 job 快速路径", () => {
    const parity = job(packageWorkflow, "release-parity");
    expect(parity).toContain("needs: release-pr-policy");
    expect(parity).not.toContain("RELEASE_BOT_TOKEN");
    expect(parity).not.toContain("name: beta-release");
    expect(parity).toContain("bun run --cwd apps/desktop/renderer test:a11y");
    expect(parity).toContain("bun run build:agent");
    expect(parity).toContain("New-SelfSignedCertificate");
    expect(parity).toContain("scripts/sign-win-agent.ts");
    expect(parity).toContain("scripts/agent-runtime-verifier.ts");
    expect(parity).toContain("--require-authenticode");
    expect(parity).toContain("Cert:\\CurrentUser\\My");
    expect(parity).toContain("Remove-Item");
    expect(parity).toContain("needs.release-pr-policy.outputs.trusted == 'true'");
    expect(parity).toContain("Accept verified Release PR receipt");
    expect(parity).not.toContain("package:win");
  });

  test("每日 canary 只有只读权限且无发布副作用入口", () => {
    expect(canaryWorkflow).toMatch(/cron: "17 19 \* \* \*"/);
    expect(canaryWorkflow).toContain("workflow_dispatch:");
    expect(canaryWorkflow).toContain("permissions:\n  contents: read");
    expect(canaryWorkflow).not.toContain("RELEASE_BOT_TOKEN");
    expect(canaryWorkflow).not.toContain("beta-release.ts");
    expect(canaryWorkflow).not.toContain("gh pr");
    expect(canaryWorkflow).not.toContain("gh release");
    expect(canaryWorkflow).not.toContain("gh run rerun");
    const canary = job(canaryWorkflow, "canary");
    expect(canary).toContain("runs-on: [self-hosted, windows, x64, codepilotx-release]");
    expect(canary).toContain("environment:\n      name: beta-release");
    expect(canary).toContain("bun run build:agent");
    expect(canary).toContain("scripts/sign-win-agent.ts");
    expect(canary).toContain("--require-authenticode");
    expect(canaryWorkflow).toContain("group: release-runner-canary-${{ github.repository }}");
    expect(canaryWorkflow).toContain("cancel-in-progress: false");
  });

  test("dry-run 回执写入隔离运行上下文并发布安全计时摘要", () => {
    const prepare = job(prepareWorkflow, "prepare");
    expect(prepare).toContain('Join-Path $env:CODEPILOTX_RELEASE_RUN_ROOT "artifacts\\receipt.json"');
    expect(prepare).toContain("Publish dry-run timing summary");
    expect(prepare).toContain("GITHUB_STEP_SUMMARY");
    expect(prepare).toContain("receipt.timings");
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
    for (const workflow of [prepareWorkflow, finalizeWorkflow, packageWorkflow, ciWorkflow, prRulesWorkflow, canaryWorkflow]) {
      for (const reference of actionReferences(workflow)) {
        expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      }
    }
  });
});
