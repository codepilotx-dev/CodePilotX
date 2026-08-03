import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const prepareWorkflow = readWorkflow("prepare-beta-release.yml");
const finalizeWorkflow = readWorkflow("finalize-beta-release.yml");
const packageWorkflow = readWorkflow("windows-x64-package.yml");
const betaReleaseScript = readFileSync(
  resolve(repositoryRoot, "scripts", "beta-release.ts"),
  "utf8",
);

function readWorkflow(name: string): string {
  return readFileSync(resolve(repositoryRoot, ".github", "workflows", name), "utf8");
}

function actionReferences(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
}

describe("beta release workflows", () => {
  test("self-hosted release workflows never accept pull request events", () => {
    for (const workflow of [prepareWorkflow, finalizeWorkflow]) {
      expect(workflow).toContain(
        "runs-on: [self-hosted, windows, x64, codepilotx-release]",
      );
      expect(workflow).not.toMatch(/^\s{2}pull_request:/m);
      expect(workflow).toContain(
        "ref: ${{ github.event_name == 'workflow_dispatch' && inputs.main_sha",
      );
      expect(workflow).toContain("persist-credentials: false");
    }
    const workflowDirectory = resolve(repositoryRoot, ".github", "workflows");
    for (const name of readdirSync(workflowDirectory)) {
      if (!/\.ya?ml$/i.test(name)) continue;
      const workflow = readFileSync(resolve(workflowDirectory, name), "utf8");
      if (/^\s{2}pull_request:/m.test(workflow)) {
        expect(workflow).not.toContain("codepilotx-release");
      }
    }
  });

  test("manual release dispatch is main-only while automatic triggers stay opt-in", () => {
    for (const workflow of [prepareWorkflow, finalizeWorkflow]) {
      expect(workflow).toContain("github.ref == 'refs/heads/main'");
      expect(workflow).toContain(
        "vars.BETA_RELEASE_AUTOMATION_ENABLED == 'true'",
      );
      expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
      expect(workflow).not.toContain(
        "github.event_name == 'workflow_dispatch' && inputs.dry_run == true",
      );
      expect(workflow).toMatch(
        /main_sha:\s+description:[^\n]+\s+required: true\s+type: string/,
      );
      expect(workflow).toMatch(
        /run-name:[\s\S]*inputs\.dry_run[\s\S]*inputs\.main_sha/,
      );
    }
  });

  test("manual prepare stays locked to the approved current main SHA", () => {
    expect(prepareWorkflow).toContain(
      '$mainSha = $env:MANUAL_MAIN_SHA.Trim().ToLowerInvariant()',
    );
    expect(prepareWorkflow).toContain(
      'if ($mainSha -ne $currentMainSha)',
    );
    expect(prepareWorkflow).toContain(
      '"${{ steps.candidate.outputs.sha }}"',
    );
  });

  test("scheduled prepare never cancels an active manual candidate", () => {
    expect(prepareWorkflow).toContain(
      "cancel-in-progress: ${{ github.event_name != 'schedule' }}",
    );
  });

  test("prepare keeps release commits detached until the remote branch is pushed", () => {
    expect(betaReleaseScript).not.toContain(
      'git(["switch", "-c", branch]',
    );
    expect(betaReleaseScript).toContain(
      'gitPush(["origin", `HEAD:refs/heads/${branch}`]',
    );
  });

  test("temporary release worktree is removed only after a clean status check", () => {
    expect(betaReleaseScript).toContain('"--untracked-files=all"');
    expect(betaReleaseScript).toContain(
      'git(["worktree", "remove", path], ROOT)',
    );
    expect(betaReleaseScript).not.toContain(
      'git(["worktree", "remove", "--force", path]',
    );
    expect(betaReleaseScript).not.toContain(
      'rm(parent, { recursive: true, force: true })',
    );
  });

  test("manual finalize targets one merge SHA and only schedules reconcile", () => {
    expect(finalizeWorkflow).toContain(
      'if ($env:GITHUB_EVENT_NAME -eq "schedule")',
    );
    expect(finalizeWorkflow).toContain(
      '$arguments = @("scripts/beta-release.ts", "reconcile")',
    );
    expect(finalizeWorkflow).toMatch(
      /else \{\s+\$arguments = @\(\s+"scripts\/beta-release\.ts",\s+"finalize",\s+"--main-sha",\s+"\$\{\{ steps\.candidate\.outputs\.sha \}\}"/,
    );
  });

  test("all actions are pinned to full commit SHAs", () => {
    for (const workflow of [
      prepareWorkflow,
      finalizeWorkflow,
      packageWorkflow,
    ]) {
      const references = actionReferences(workflow);
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      }
    }
  });

  test("tag publishing verifies that the tagged commit belongs to main", () => {
    expect(packageWorkflow).toContain(
      "git merge-base --is-ancestor $tagCommit refs/remotes/origin/main",
    );
    expect(packageWorkflow.indexOf("Verify tag target belongs to main")).toBeLessThan(
      packageWorkflow.indexOf("Build unsigned release package"),
    );
  });
});
