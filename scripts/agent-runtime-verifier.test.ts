/**
 * agent-runtime-verifier.test.ts — 打包 Agent 运行时验证门面的失败与安全边界
 */

import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import {
  assertAuthenticodeValid,
  sanitizeVerifierError,
  verifyPackagedAgentRuntime,
} from "./agent-runtime-verifier.ts";

const fixture = resolve(import.meta.dir, "fixtures", "fake-packaged-agent.ts");

// 假 Agent 通过 bun.exe 启动；整套件负载下冷启动可达 15 秒，
// 因此每个用例显式给出 90 秒预算，避免与 bun 默认 5 秒测试超时竞争。
const TEST_TIMEOUT_MS = 90_000;

function verify(mode: string, options: Record<string, unknown> = {}) {
  return verifyPackagedAgentRuntime({
    agentPath: process.execPath,
    agentArgs: [fixture, mode],
    readyTimeoutMs: 30_000,
    ...options,
  } as Parameters<typeof verifyPackagedAgentRuntime>[0]);
}

describe("packaged agent runtime verifier", () => {
  it("ready 成功后返回安全的运行指标", async () => {
    const result = await verify("ready");
    expect(result.schemaVersion).toBe(1);
    expect(result.providerCount).toBeGreaterThan(0);
    expect(result.modelCount).toBeGreaterThan(0);
    expect(result.processTreeCleaned).toBe(true);
    expect(Number.isSafeInteger(result.readyMs)).toBe(true);
    expect(Number.isSafeInteger(result.apiReadyMs)).toBe(true);
  }, TEST_TIMEOUT_MS);

  it("ready 前提前退出时失败", async () => {
    await expect(verify("early-exit")).rejects.toThrow("提前退出");
  }, TEST_TIMEOUT_MS);

  it("ready 超时时失败", async () => {
    await expect(verify("timeout", { readyTimeoutMs: 40_000 })).rejects.toThrow(
      "秒内未就绪",
    );
  }, TEST_TIMEOUT_MS);

  it("Provider/model 目录无效时失败", async () => {
    await expect(verify("bad-catalog")).rejects.toThrow("Provider 目录");
  }, TEST_TIMEOUT_MS);

  it("Authenticode 非 Valid 状态被拒绝", async () => {
    const status = await authenticodeStatus(process.execPath);
    if (status === "Valid") return; // 本机 bun.exe 恰好签名时跳过
    await expect(assertAuthenticodeValid([process.execPath])).rejects.toThrow(
      "Windows Authenticode 验证失败",
    );
  }, TEST_TIMEOUT_MS);

  it("安全错误不泄漏本地绝对路径", () => {
    const sanitized = sanitizeVerifierError("failed at C:\\Users\\secret\\x\\y");
    expect(sanitized).not.toContain("C:\\Users\\secret");
    expect(sanitized).toContain("[LOCAL_PATH]");
  });
});

async function authenticodeStatus(path: string): Promise<string> {
  const powershell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  const child = Bun.spawn([
    powershell,
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `(Get-AuthenticodeSignature -LiteralPath '${path.replaceAll("'", "''")}').Status`,
  ], { stdout: "pipe", stderr: "ignore", windowsHide: true });
  return (await new Response(child.stdout).text()).trim();
}
