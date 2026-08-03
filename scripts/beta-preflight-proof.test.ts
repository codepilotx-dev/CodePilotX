import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BETA_PREFLIGHT_BUN_VERSION,
  BETA_PREFLIGHT_PLATFORM,
  BETA_PREFLIGHT_REPOSITORY,
  BETA_PREFLIGHT_SUITE,
  BETA_PREFLIGHT_VALIDITY_MS,
  assertBetaPreflightProofExpectations,
  canonicalizeBetaPreflightProof,
  createBetaPreflightProof,
  digestBetaPreflightPayload,
  encodeBetaPreflightProofInputs,
  signBetaPreflightProof,
  verifyBetaPreflightProof,
  verifyBetaPreflightProofInputs,
  type BetaPreflightProofV1,
  type SignedBetaPreflightProofV1,
} from "./beta-preflight-proof.ts";

const SIGNER = "release@example.com";
const MAIN_SHA = "1".repeat(40);
const RELEASE_TREE_SHA = "2".repeat(40);
const COMPLETED_AT = new Date("2026-08-03T02:00:00.000Z");
const NOW = new Date("2026-08-03T03:00:00.000Z");

setDefaultTimeout(30_000);

let fixtureDirectory = "";
let keyFile = "";
let attackerKeyFile = "";
let allowedSignersFile = "";

beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "codepilotx-beta-proof-test-"));
  keyFile = join(fixtureDirectory, "signing-key");
  attackerKeyFile = join(fixtureDirectory, "attacker-key");
  allowedSignersFile = join(fixtureDirectory, "allowed-signers");
  const generated = spawnSync("ssh-keygen", [
    "-q", "-t", "ed25519", "-N", "", "-C", "beta-proof-test", "-f", keyFile,
  ], { encoding: "utf8", windowsHide: true });
  if (generated.status !== 0 || generated.error) {
    throw new Error("测试环境无法生成临时 SSH 密钥");
  }
  const publicKey = readFileSync(`${keyFile}.pub`, "utf8");
  writeFileSync(allowedSignersFile, `${SIGNER} ${publicKey.trim()}\n`, "utf8");
}, 20_000);

afterAll(() => {
  if (fixtureDirectory) {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

function baseProof(): BetaPreflightProofV1 {
  return createBetaPreflightProof({
    mainSha: MAIN_SHA,
    releaseTreeSha: RELEASE_TREE_SHA,
    nextVersion: "0.2.0-beta.4",
    nextTag: "v0.2.0-beta.4",
    completedAt: COMPLETED_AT,
  });
}

function signedProof(proof = baseProof()): SignedBetaPreflightProofV1 {
  return signBetaPreflightProof(proof, { signingKeyFile: keyFile });
}

function verify(
  signed: SignedBetaPreflightProofV1,
  overrides: Partial<Parameters<typeof verifyBetaPreflightProof>[1]> = {},
) {
  return verifyBetaPreflightProof(signed, {
    allowedSignersFile,
    signerIdentity: SIGNER,
    expected: {
      mainSha: MAIN_SHA,
      releaseTreeSha: RELEASE_TREE_SHA,
      nextVersion: "0.2.0-beta.4",
      nextTag: "v0.2.0-beta.4",
    },
    now: NOW,
    ...overrides,
  });
}

function signedMutation(
  changes: Partial<BetaPreflightProofV1>,
): SignedBetaPreflightProofV1 {
  return signedProof({ ...baseProof(), ...changes });
}

describe("BetaPreflightProofV1", () => {
  it("生成固定顺序的规范 JSON、摘要，并接受受信任 SSH 签名", () => {
    const signed = signedProof();
    expect(signed.payload).toBe(canonicalizeBetaPreflightProof(baseProof()));
    expect(signed.payload.endsWith("\n")).toBe(false);
    expect(signed.digest).toBe(digestBetaPreflightPayload(signed.payload));
    expect(verify(signed)).toEqual(baseProof());
    expect(verifyBetaPreflightProofInputs(
      encodeBetaPreflightProofInputs(signed),
      {
        allowedSignersFile,
        signerIdentity: SIGNER,
        expected: {
          mainSha: MAIN_SHA,
          releaseTreeSha: RELEASE_TREE_SHA,
          nextVersion: "0.2.0-beta.4",
          nextTag: "v0.2.0-beta.4",
        },
        now: NOW,
      },
    )).toEqual(baseProof());
  });

  it("拒绝非规范 Base64 workflow 输入", () => {
    const inputs = encodeBetaPreflightProofInputs(signedProof());
    expect(() => verifyBetaPreflightProofInputs({
      ...inputs,
      preflightPayload: `${inputs.preflightPayload}\n`,
    }, {
      allowedSignersFile,
      signerIdentity: SIGNER,
      expected: {
        mainSha: MAIN_SHA,
        releaseTreeSha: RELEASE_TREE_SHA,
        nextVersion: "0.2.0-beta.4",
        nextTag: "v0.2.0-beta.4",
      },
      now: NOW,
    })).toThrow("不是规范 Base64");
  });

  it("拒绝 payload 篡改，即使攻击者重算摘要", () => {
    const signed = signedProof();
    const payload = signed.payload.replace("0.2.0-beta.4", "0.2.0-beta.5");
    expect(() => verify({
      ...signed,
      payload,
      digest: digestBetaPreflightPayload(payload),
    })).toThrow("SSH 签名无效");
  });

  it("拒绝错误 signer identity", () => {
    expect(() => verify(signedProof(), {
      signerIdentity: "attacker@example.com",
    })).toThrow("签名者不受信任");
    const attackerGenerated = spawnSync("ssh-keygen", [
      "-q", "-t", "ed25519", "-N", "", "-C", "beta-proof-attacker", "-f",
      attackerKeyFile,
    ], { encoding: "utf8", windowsHide: true });
    if (attackerGenerated.status !== 0 || attackerGenerated.error) {
      throw new Error("测试环境无法生成第二把临时 SSH 密钥");
    }
    expect(() => verify(signBetaPreflightProof(baseProof(), {
      signingKeyFile: attackerKeyFile,
    }))).toThrow("签名者不受信任");
  }, 60_000);

  it("拒绝错误 SHA、release tree、版本和标签期望", () => {
    const proof = baseProof();
    const expected = {
      mainSha: MAIN_SHA,
      releaseTreeSha: RELEASE_TREE_SHA,
      nextVersion: "0.2.0-beta.4",
      nextTag: "v0.2.0-beta.4",
    };
    expect(() => assertBetaPreflightProofExpectations(
      proof,
      { ...expected, mainSha: "3".repeat(40) },
    )).toThrow("main SHA 不匹配");
    expect(() => assertBetaPreflightProofExpectations(
      proof,
      { ...expected, releaseTreeSha: "4".repeat(40) },
    )).toThrow("release tree 不匹配");
    expect(() => assertBetaPreflightProofExpectations(
      proof,
      { ...expected, nextVersion: "0.2.0-beta.5" },
    )).toThrow("版本不匹配");
    expect(() => assertBetaPreflightProofExpectations(
      proof,
      { ...expected, nextTag: "v0.2.0-beta.5" },
    )).toThrow("标签不匹配");
  });

  it("拒绝过期和超前超过五分钟的证明", () => {
    expect(() => verify(signedProof(), {
      now: new Date(COMPLETED_AT.getTime() + BETA_PREFLIGHT_VALIDITY_MS + 5 * 60_000 + 1),
    })).toThrow("已过期");
    expect(() => verify(signedMutation({
      completedAt: new Date(NOW.getTime() + 5 * 60_000 + 1).toISOString(),
      expiresAt: new Date(NOW.getTime() + 5 * 60_000 + 1 + BETA_PREFLIGHT_VALIDITY_MS).toISOString(),
    }))).toThrow("完成时间晚于");
  });

  it("拒绝错误 repository、平台、Bun、suite 和结果", () => {
    expect(() => verify(signedMutation({
      repository: "other/repository" as typeof BETA_PREFLIGHT_REPOSITORY,
    }))).toThrow("repository 不匹配");
    expect(() => verify(signedMutation({
      platform: "linux-x64" as typeof BETA_PREFLIGHT_PLATFORM,
    }))).toThrow("平台不匹配");
    expect(() => verify(signedMutation({
      bunVersion: "1.3.13" as typeof BETA_PREFLIGHT_BUN_VERSION,
    }))).toThrow("Bun 版本不匹配");
    expect(() => verify(signedMutation({
      suite: "other-suite" as typeof BETA_PREFLIGHT_SUITE,
    }))).toThrow("suite 不匹配");
    expect(() => verify(signedMutation({
      result: "failed" as "passed",
    }))).toThrow("结果不是 passed");
  });

  it("拒绝非规范字段顺序和超过 24 小时的声明有效期", () => {
    const signed = signedProof();
    const parsed = JSON.parse(signed.payload) as Record<string, unknown>;
    const reorderedPayload = JSON.stringify({
      repository: parsed.repository,
      schemaVersion: parsed.schemaVersion,
      ...Object.fromEntries(Object.entries(parsed).slice(2)),
    });
    const reordered = signBetaPreflightProof(
      baseProof(),
      { signingKeyFile: keyFile },
    );
    expect(() => verify({
      ...reordered,
      payload: reorderedPayload,
      digest: digestBetaPreflightPayload(reorderedPayload),
    })).toThrow();

    expect(() => verify(signedMutation({
      expiresAt: new Date(COMPLETED_AT.getTime() + BETA_PREFLIGHT_VALIDITY_MS + 1)
        .toISOString(),
    }))).toThrow("有效期不是 24 小时");
  });
});
