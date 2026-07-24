import { AgentError } from "../domain"
import {
  toPublicSandboxStatus,
  type PublicSandboxStatus,
  type SandboxStatus,
} from "./SandboxRuntimeAdapter"

export function sandboxResult(status: SandboxStatus): { sandbox: PublicSandboxStatus } {
  return { sandbox: toPublicSandboxStatus(status) }
}

export function requireAvailableSandbox(
  status: SandboxStatus,
  operation: "安装" | "修复",
): { sandbox: PublicSandboxStatus } {
  const result = sandboxResult(status)
  if (status.state !== "available") {
    throw new AgentError(
      "SANDBOX_UNAVAILABLE",
      `SRT 沙箱${operation}后仍不可用：${status.error ?? "请重试或在设置中检查沙箱状态。"}`,
      503,
      result.sandbox,
    )
  }
  return result
}
