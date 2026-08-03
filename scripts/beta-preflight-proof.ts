import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const BETA_PREFLIGHT_REPOSITORY = "codepilotx-dev/CodePilotX" as const;
export const BETA_PREFLIGHT_SUITE = "codepilotx-beta-local-v1" as const;
export const BETA_PREFLIGHT_BUN_VERSION = "1.3.14" as const;
export const BETA_PREFLIGHT_PLATFORM = "win32-x64" as const;
export const BETA_PREFLIGHT_NAMESPACE = "codepilotx-beta-preflight" as const;
export const BETA_PREFLIGHT_SIGNER_IDENTITY = "xouyang525@gmail.com" as const;
export const BETA_PREFLIGHT_VALIDITY_MS = 24 * 60 * 60 * 1_000;
export const BETA_PREFLIGHT_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const SHA_RE = /^[0-9a-f]{40}$/;
const BETA_VERSION_RE = /^\d+\.\d+\.\d+-beta\.\d+$/;
const PROOF_KEYS = [
  "schemaVersion",
  "repository",
  "mainSha",
  "releaseTreeSha",
  "nextVersion",
  "nextTag",
  "suite",
  "bunVersion",
  "platform",
  "completedAt",
  "expiresAt",
  "result",
] as const;

export interface BetaPreflightProofV1 {
  schemaVersion: 1;
  repository: typeof BETA_PREFLIGHT_REPOSITORY;
  mainSha: string;
  releaseTreeSha: string;
  nextVersion: string;
  nextTag: string;
  suite: typeof BETA_PREFLIGHT_SUITE;
  bunVersion: typeof BETA_PREFLIGHT_BUN_VERSION;
  platform: typeof BETA_PREFLIGHT_PLATFORM;
  completedAt: string;
  expiresAt: string;
  result: "passed";
}

export interface SignedBetaPreflightProofV1 {
  payload: string;
  digest: string;
  signature: string;
}

export interface BetaPreflightProofInputsV1 {
  preflightPayload: string;
  preflightDigest: string;
  preflightSignature: string;
}

export interface BetaPreflightExpectations {
  mainSha: string;
  releaseTreeSha: string;
  nextVersion: string;
  nextTag: string;
}

interface SshOptions {
  sshKeygenPath?: string;
}

export interface SignBetaPreflightProofOptions extends SshOptions {
  signingKeyFile: string;
}

export interface VerifyBetaPreflightProofOptions extends SshOptions {
  allowedSignersFile: string;
  signerIdentity: string;
  expected: BetaPreflightExpectations;
  now?: Date;
}

function canonicalDate(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Beta 预检证明的 ${field} 不是规范 UTC 时间`);
  }
  return timestamp;
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Beta 预检证明的 ${field} 类型无效`);
  }
}

function parseAndValidateShape(payload: string): BetaPreflightProofV1 {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Beta 预检证明 payload 不是有效 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Beta 预检证明 payload 结构无效");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== PROOF_KEYS.length ||
      keys.some((key, index) => key !== PROOF_KEYS[index])) {
    throw new Error("Beta 预检证明 payload 不是规范字段集合或顺序");
  }
  if (record.schemaVersion !== 1) {
    throw new Error("Beta 预检证明 schemaVersion 无效");
  }
  for (const key of PROOF_KEYS.slice(1)) {
    assertString(record[key], key);
  }
  return record as unknown as BetaPreflightProofV1;
}

export function canonicalizeBetaPreflightProof(
  proof: BetaPreflightProofV1,
): string {
  const canonical = {
    schemaVersion: proof.schemaVersion,
    repository: proof.repository,
    mainSha: proof.mainSha,
    releaseTreeSha: proof.releaseTreeSha,
    nextVersion: proof.nextVersion,
    nextTag: proof.nextTag,
    suite: proof.suite,
    bunVersion: proof.bunVersion,
    platform: proof.platform,
    completedAt: proof.completedAt,
    expiresAt: proof.expiresAt,
    result: proof.result,
  };
  return JSON.stringify(canonical);
}

export function digestBetaPreflightPayload(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function encodeBetaPreflightProofInputs(
  signed: SignedBetaPreflightProofV1,
): BetaPreflightProofInputsV1 {
  return {
    preflightPayload: Buffer.from(signed.payload, "utf8").toString("base64"),
    preflightDigest: signed.digest,
    preflightSignature: Buffer.from(signed.signature, "utf8").toString("base64"),
  };
}

function decodeStrictBase64(value: string, field: string): string {
  if (value.length === 0 || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Beta 预检证明的 ${field} 不是规范 Base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error(`Beta 预检证明的 ${field} 不是规范 Base64`);
  }
  return bytes.toString("utf8");
}

export function decodeBetaPreflightProofInputs(
  inputs: BetaPreflightProofInputsV1,
): SignedBetaPreflightProofV1 {
  return {
    payload: decodeStrictBase64(inputs.preflightPayload, "payload"),
    digest: inputs.preflightDigest,
    signature: decodeStrictBase64(inputs.preflightSignature, "signature"),
  };
}

export function createBetaPreflightProof(
  input: Omit<BetaPreflightProofV1,
    "schemaVersion" | "repository" | "suite" | "bunVersion" |
    "platform" | "completedAt" | "expiresAt" | "result"> & {
      completedAt?: Date;
    },
): BetaPreflightProofV1 {
  const completedAt = input.completedAt ?? new Date();
  return {
    schemaVersion: 1,
    repository: BETA_PREFLIGHT_REPOSITORY,
    mainSha: input.mainSha,
    releaseTreeSha: input.releaseTreeSha,
    nextVersion: input.nextVersion,
    nextTag: input.nextTag,
    suite: BETA_PREFLIGHT_SUITE,
    bunVersion: BETA_PREFLIGHT_BUN_VERSION,
    platform: BETA_PREFLIGHT_PLATFORM,
    completedAt: completedAt.toISOString(),
    expiresAt: new Date(completedAt.getTime() + BETA_PREFLIGHT_VALIDITY_MS)
      .toISOString(),
    result: "passed",
  };
}

function withProofFiles<T>(
  payload: string,
  signature: string | null,
  callback: (payloadFile: string, signatureFile: string) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), "codepilotx-beta-proof-"));
  const payloadFile = join(directory, "proof.json");
  const signatureFile = `${payloadFile}.sig`;
  try {
    writeFileSync(payloadFile, payload, "utf8");
    if (signature !== null) {
      writeFileSync(signatureFile, signature, "utf8");
    }
    return callback(payloadFile, signatureFile);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function signBetaPreflightProof(
  proof: BetaPreflightProofV1,
  options: SignBetaPreflightProofOptions,
): SignedBetaPreflightProofV1 {
  const payload = canonicalizeBetaPreflightProof(proof);
  const signature = withProofFiles(payload, null, (payloadFile, signatureFile) => {
    const result = spawnSync(options.sshKeygenPath ?? "ssh-keygen", [
      "-Y", "sign",
      "-f", options.signingKeyFile,
      "-n", BETA_PREFLIGHT_NAMESPACE,
      payloadFile,
    ], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || result.error) {
      throw new Error("无法使用维护者 SSH 密钥签署 Beta 预检证明");
    }
    try {
      return readFileSync(signatureFile, "utf8");
    } catch {
      throw new Error("SSH 签名命令未生成 Beta 预检签名");
    }
  });
  return {
    payload,
    digest: digestBetaPreflightPayload(payload),
    signature,
  };
}

export function verifyBetaPreflightProof(
  signed: SignedBetaPreflightProofV1,
  options: VerifyBetaPreflightProofOptions,
): BetaPreflightProofV1 {
  if (!/^[0-9a-f]{64}$/.test(signed.digest) ||
      digestBetaPreflightPayload(signed.payload) !== signed.digest) {
    throw new Error("Beta 预检证明摘要不匹配");
  }

  const proof = parseAndValidateShape(signed.payload);
  if (canonicalizeBetaPreflightProof(proof) !== signed.payload) {
    throw new Error("Beta 预检证明 payload 不是规范 JSON");
  }

  const verificationPassed = withProofFiles(
    signed.payload,
    signed.signature,
    (payloadFile, signatureFile) => {
      const result = spawnSync(options.sshKeygenPath ?? "ssh-keygen", [
        "-Y", "verify",
        "-f", options.allowedSignersFile,
        "-I", options.signerIdentity,
        "-n", BETA_PREFLIGHT_NAMESPACE,
        "-s", signatureFile,
      ], {
        encoding: "utf8",
        input: readFileSync(payloadFile),
        windowsHide: true,
      });
      return result.status === 0 && !result.error;
    },
  );
  if (!verificationPassed) {
    throw new Error("Beta 预检证明 SSH 签名无效或签名者不受信任");
  }

  if (proof.repository !== BETA_PREFLIGHT_REPOSITORY) {
    throw new Error("Beta 预检证明 repository 不匹配");
  }
  if (proof.suite !== BETA_PREFLIGHT_SUITE) {
    throw new Error("Beta 预检证明 suite 不匹配");
  }
  if (proof.bunVersion !== BETA_PREFLIGHT_BUN_VERSION) {
    throw new Error("Beta 预检证明 Bun 版本不匹配");
  }
  if (proof.platform !== BETA_PREFLIGHT_PLATFORM) {
    throw new Error("Beta 预检证明平台不匹配");
  }
  if (proof.result !== "passed") {
    throw new Error("Beta 预检证明结果不是 passed");
  }
  if (!SHA_RE.test(proof.mainSha) || !SHA_RE.test(proof.releaseTreeSha)) {
    throw new Error("Beta 预检证明 SHA 格式无效");
  }
  if (!BETA_VERSION_RE.test(proof.nextVersion) ||
      proof.nextTag !== `v${proof.nextVersion}`) {
    throw new Error("Beta 预检证明版本或标签无效");
  }

  const expected = options.expected;
  if (proof.mainSha !== expected.mainSha) {
    throw new Error("Beta 预检证明 main SHA 不匹配");
  }
  if (proof.releaseTreeSha !== expected.releaseTreeSha) {
    throw new Error("Beta 预检证明 release tree 不匹配");
  }
  if (proof.nextVersion !== expected.nextVersion) {
    throw new Error("Beta 预检证明版本不匹配");
  }
  if (proof.nextTag !== expected.nextTag) {
    throw new Error("Beta 预检证明标签不匹配");
  }

  const completedAt = canonicalDate(proof.completedAt, "completedAt");
  const expiresAt = canonicalDate(proof.expiresAt, "expiresAt");
  if (expiresAt - completedAt !== BETA_PREFLIGHT_VALIDITY_MS) {
    throw new Error("Beta 预检证明有效期不是 24 小时");
  }
  const now = (options.now ?? new Date()).getTime();
  if (completedAt > now + BETA_PREFLIGHT_CLOCK_SKEW_MS) {
    throw new Error("Beta 预检证明完成时间晚于允许的时钟偏差");
  }
  if (expiresAt < now - BETA_PREFLIGHT_CLOCK_SKEW_MS) {
    throw new Error("Beta 预检证明已过期");
  }

  return proof;
}

export function verifyBetaPreflightProofInputs(
  inputs: BetaPreflightProofInputsV1,
  options: VerifyBetaPreflightProofOptions,
): BetaPreflightProofV1 {
  return verifyBetaPreflightProof(decodeBetaPreflightProofInputs(inputs), options);
}
