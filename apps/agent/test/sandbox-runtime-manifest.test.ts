import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  SRT_INSTALL_GENERATION,
  SRT_MAX_CONCURRENT_COMMANDS,
  SRT_PROXY_PORT_RANGE,
  SRT_RUNTIME_VERSION,
  SRT_WINDOWS_HELPER_SHA256,
  SRT_WINDOWS_MATURITY,
  SRT_WORKER_PROTOCOL_VERSION,
} from "../src/sandbox/SandboxRuntimeManifest"
import { verifySrtRuntimeManifest } from "../../../scripts/verify-srt-runtime-manifest"

describe("SRT runtime manifest", () => {
  test("运行时、依赖与 Windows helper 使用同一固定清单", async () => {
    const workspaceRoot = resolve(import.meta.dir, "../../..")
    const verified = await verifySrtRuntimeManifest(workspaceRoot)

    expect(verified).toEqual({
      runtimeVersion: "0.0.65",
      proxyPortRange: [60080, 60095],
      maxConcurrentCommands: 8,
      helperSha256: {
        x64: "777736e17d6cf9b4280f155f5cda731fdff0f789fa16e6cb3adc0006073e241a",
        arm64: "17a63aa8c010662b3e723f75d13d8672c69beeca8d072f4b2dce7484e850023a",
      },
    })
    expect(SRT_RUNTIME_VERSION).toBe(verified.runtimeVersion)
    expect([...verified.proxyPortRange]).toEqual([...SRT_PROXY_PORT_RANGE])
    expect(SRT_MAX_CONCURRENT_COMMANDS).toBe(verified.maxConcurrentCommands)
    expect(SRT_WINDOWS_HELPER_SHA256).toEqual(verified.helperSha256)
    expect(SRT_WINDOWS_MATURITY).toBe("alpha")
    expect(SRT_INSTALL_GENERATION).toBe(2)
    expect(SRT_WORKER_PROTOCOL_VERSION).toBe(1)
  })
})
