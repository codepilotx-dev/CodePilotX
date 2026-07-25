import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { AgentError } from "../domain"
import { SRT_WINDOWS_HELPER_SHA256, type SrtWindowsArchitecture } from "./SandboxRuntimeManifest"

export function validateSrtHelper(path: string) {
  const expected = SRT_WINDOWS_HELPER_SHA256[process.arch as SrtWindowsArchitecture]
  if (!expected) {
    throw new AgentError("SANDBOX_HELPER_UNSUPPORTED", `没有 ${process.arch} 的 SRT helper 校验清单`, 503)
  }
  const image = readFileSync(path)
  const digest = createHash("sha256").update(image).digest("hex")
  if (digest !== expected) {
    throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper SHA-256 校验失败", 503)
  }
  if (image.length < 0x40 || image.toString("ascii", 0, 2) !== "MZ") {
    throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper 不是有效的 Windows PE 文件", 503)
  }
  const peOffset = image.readUInt32LE(0x3c)
  if (peOffset + 6 > image.length || image.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper PE 头无效", 503)
  }
  const machine = image.readUInt16LE(peOffset + 4)
  const expectedMachine = process.arch === "x64" ? 0x8664 : 0xaa64
  if (machine !== expectedMachine) {
    throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper 架构与 Agent 不匹配", 503)
  }
  return digest
}
