import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { AnthropicSandboxRuntimeAdapter } from "../src/sandbox/SandboxRuntimeAdapter"
import { generateSandboxPolicy } from "../src/sandbox/SandboxPolicy"
import { SandboxWorkerPool } from "../src/sandbox/SandboxWorkerPool"

const enabled = process.platform === "win32"
  && process.env.CODEPILOTX_RUN_SRT_E2E === "1"
const windowsSrtTest = enabled ? test : test.skip
const agentEntrypoint = fileURLToPath(new URL("../src/index.ts", import.meta.url))
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url))

const permissionConfig = {
  sandboxMode: "workspace-write" as const,
  approvalPolicy: "on-request" as const,
  approvalsReviewer: "user" as const,
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

async function waitFor(predicate: () => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待 Windows SRT E2E 条件超时")
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }
}

windowsSrtTest("Windows SRT 真实并发、隔离、断网、取消及后续恢复", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-srt-e2e-"))
  const workspaceA = join(root, "workspace-a")
  const workspaceB = join(root, "workspace-b")
  const dataDir = join(root, "agent-data")
  const adapter = new AnthropicSandboxRuntimeAdapter({
    workerPool: new SandboxWorkerPool({
      command: () => ({
        executable: process.execPath,
        args: [agentEntrypoint, "--sandbox-worker"],
        cwd: repositoryRoot,
      }),
    }),
  })
  await Promise.all([mkdir(workspaceA), mkdir(workspaceB), mkdir(dataDir)])
  await writeFile(join(workspaceB, "secret.txt"), "workspace-b-secret", "utf8")

  const policy = (workspace: string, sessionTemp: string, domains: string[] = []) =>
    generateSandboxPolicy({
      workspace,
      sessionTemp,
      dataDir,
      permissionConfig,
      additionalPermissions: { networkDomains: domains },
    }).config

  try {
    const status = await adapter.refreshStatus()
    expect(status.state).toBe("available")

    const temps = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      mkdtemp(join(root, `temp-${index}-`))
    ))
    const gate = join(workspaceA, "release.gate")
    const parallel = temps.map((sessionTemp, index) => adapter.run({
      command: [
        `Set-Content -LiteralPath ${quote(join(workspaceA, `ready-${index}`))} -Value ready`,
        `while (-not (Test-Path -LiteralPath ${quote(gate)})) { Start-Sleep -Milliseconds 50 }`,
        `Set-Content -LiteralPath ${quote(join(workspaceA, `done-${index}`))} -Value done`,
      ].join("; "),
      cwd: workspaceA,
      config: policy(workspaceA, sessionTemp),
      timeoutMs: 60_000,
    }))
    await waitFor(() => Array.from({ length: 8 }, (_, index) =>
      existsSync(join(workspaceA, `ready-${index}`))
    ).every(Boolean))
    await writeFile(gate, "release", "utf8")
    const parallelResults = await Promise.all(parallel)
    expect(parallelResults.every(({ exitCode }) => exitCode === 0)).toBe(true)

    const isolatedTemp = await mkdtemp(join(root, "temp-isolated-"))
    const crossWorkspace = await adapter.run({
      command: `Get-Content -LiteralPath ${quote(join(workspaceB, "secret.txt"))}`,
      cwd: workspaceA,
      config: policy(workspaceA, isolatedTemp),
      timeoutMs: 15_000,
    })
    expect(crossWorkspace.exitCode).not.toBe(0)
    expect(crossWorkspace.stdout).not.toContain("workspace-b-secret")

    const networkTemp = await mkdtemp(join(root, "temp-network-"))
    const blockedNetwork = await adapter.run({
      command: "Invoke-WebRequest -UseBasicParsing -Uri 'https://example.com' -TimeoutSec 5",
      cwd: workspaceA,
      config: policy(workspaceA, networkTemp),
      timeoutMs: 15_000,
    })
    expect(blockedNetwork.exitCode).not.toBe(0)

    const cancelTemp = await mkdtemp(join(root, "temp-cancel-"))
    const controller = new AbortController()
    const cancelled = adapter.run({
      command: "Start-Sleep -Seconds 60",
      cwd: workspaceA,
      config: policy(workspaceA, cancelTemp),
      timeoutMs: 90_000,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 250)
    await expect(cancelled).rejects.toMatchObject({ code: "RUN_ABORTED" })

    const recoveryTemp = await mkdtemp(join(root, "temp-recovery-"))
    await expect(adapter.run({
      command: "Write-Output recovered",
      cwd: workspaceA,
      config: policy(workspaceA, recoveryTemp),
      timeoutMs: 15_000,
    })).resolves.toMatchObject({ exitCode: 0, stdout: expect.stringContaining("recovered") })
  } finally {
    await adapter.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 180_000)
