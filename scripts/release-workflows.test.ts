import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const packageWorkflow = readWorkflow("windows-x64-package.yml");
const ciWorkflow = readWorkflow("ci.yml");
const prRulesWorkflow = readWorkflow("pr-rules.yml");

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

describe("release workflows", () => {
  test("ordinary pull requests never enter a self-hosted release runner", () => {
    expect(job(packageWorkflow, "unsigned-smoke")).toContain("runs-on: windows-latest");
    expect(job(packageWorkflow, "unsigned-smoke")).not.toContain("codepilotx-release");
    expect(job(packageWorkflow, "release-parity")).toContain("runs-on: windows-latest");
    expect(job(packageWorkflow, "release-parity")).not.toContain("codepilotx-release");
  });

  test("release-parity actually runs synthetic signing, verifier and cleanup", () => {
    const parity = job(packageWorkflow, "release-parity");
    expect(parity).toContain("New-SelfSignedCertificate");
    expect(parity).toContain("scripts/sign-win-agent.ts");
    expect(parity).toContain("scripts/agent-runtime-verifier.ts");
    expect(parity).toContain("--require-authenticode");
    expect(parity).toContain("--authenticode-trust-anchor");
    expect(parity).toContain("Cert:\\CurrentUser\\My");
    expect(parity).toContain('X509Store("My", "CurrentUser")');
    expect(parity).toContain("$store.Remove($c)");
    expect(parity).toContain("bun scripts/release-run-context.ts create");
    expect(parity).toContain("bun scripts/release-run-context.ts dispose");
    expect(parity).not.toContain("needs.release-pr-policy");
    expect(parity).not.toContain("Accept verified Release PR receipt");
    expect(parity).not.toContain("RELEASE_BOT_TOKEN");
    expect(parity).not.toContain("name: beta-release");
  });

  test("package-release only triggers on v* tags with signed self-hosted packaging", () => {
    const packageRelease = job(packageWorkflow, "package-release");
    expect(packageRelease).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    );
    expect(packageRelease).toContain(
      "runs-on: [self-hosted, windows, x64, codepilotx-release]",
    );
    expect(packageRelease).toContain("name: beta-release");
    expect(packageRelease).toContain("Verify tag target belongs to main");
    expect(packageRelease).toContain('CODEPILOTX_REQUIRE_SIGNING: "1"');
    expect(packageRelease).toContain("scripts/smoke-installed-win-x64.ps1");
    expect(packageRelease).toContain("anchore/sbom-action@");
    expect(packageRelease).toContain("release/SHA256SUMS.txt");
    expect(packageRelease).toContain("release/RELEASE_NOTES.md");
  });

  test("package-release no longer references Release PR automation", () => {
    const packageRelease = job(packageWorkflow, "package-release");
    expect(packageRelease).not.toContain("Verify trusted Release PR identity");
    expect(packageRelease).not.toContain("automation/release-v");
    expect(packageRelease).not.toContain("automation:beta-release");
    expect(packageRelease).not.toContain("codepilotx-beta-release");
    expect(packageRelease).not.toContain("verify-release-pr-policy");
    expect(packageRelease).not.toContain("beta-preflight.allowed_signers");
    expect(packageRelease).not.toContain("release-pr-policy");
  });

  test("publish-release only downloads, attests and publishes the unique artifact", () => {
    const publish = job(packageWorkflow, "publish-release");
    expect(publish).toContain("runs-on: ubuntu-latest");
    expect(publish).toContain("actions/download-artifact@");
    expect(publish).toContain("actions/attest-build-provenance@");
    expect(publish).toContain("actions/attest-sbom@");
    expect(publish).not.toContain("package:win");
    expect(publish).not.toContain("setup-bun");
  });

  test("ordinary PR CI jobs are preserved and run for every pull request", () => {
    for (const requiredJob of ["quality", "unit-tests", "dependency-audit"]) {
      const required = job(ciWorkflow, requiredJob);
      expect(required).not.toContain("needs: release-pr-policy");
      expect(required).not.toContain("needs.release-pr-policy");
      expect(required).not.toContain("Accept verified Release PR receipt");
    }
    for (const workflow of [ciWorkflow, prRulesWorkflow, packageWorkflow]) {
      expect(workflow).toContain("types: [opened, synchronize, reopened]");
      expect(workflow).not.toContain("labeled");
    }
    expect(prRulesWorkflow).toContain("changelog-check:");
    expect(prRulesWorkflow).not.toContain("release-pr-policy");
    expect(prRulesWorkflow).not.toContain("RELEASE_BOT_LOGIN");
    expect(packageWorkflow).not.toContain("release-pr-policy:");
    expect(packageWorkflow).not.toContain("pull-requests: read");
  });

  test("all actions are pinned to full commit SHAs", () => {
    for (const workflow of [packageWorkflow, ciWorkflow, prRulesWorkflow]) {
      for (const reference of actionReferences(workflow)) {
        expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      }
    }
  });
});
