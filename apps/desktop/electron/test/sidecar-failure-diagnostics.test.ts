import { describe, expect, test } from "bun:test"
import {
  isSidecarConnectStage,
  isSidecarFailureCode,
  readSidecarFailureCode,
} from "../src/sidecar/failure-diagnostics"

describe("Sidecar 安全失败诊断", () => {
  test("只接受固定阶段与错误码", () => {
    expect(isSidecarConnectStage("spawn-process")).toBe(true)
    expect(isSidecarConnectStage("C:\\private\\agent.exe")).toBe(false)
    expect(isSidecarFailureCode("EACCES")).toBe(true)
    expect(isSidecarFailureCode("TOKEN_secret-value")).toBe(false)
  })

  test("未知错误不会泄露原始 code 或 message", () => {
    const error = Object.assign(
      new Error("Bearer secret-token at C:\\private\\agent.exe"),
      { code: "PRIVATE_secret-token" },
    )
    expect(readSidecarFailureCode(error)).toBe("unknown")
    expect(readSidecarFailureCode({ code: "EINVAL" })).toBe("EINVAL")
  })
})
