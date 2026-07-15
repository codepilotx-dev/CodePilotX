import type { ToolInvocation } from "../domain"

export const isShellInvocation = (invocation: ToolInvocation) => {
  if (invocation.name === "propose_command") return false
  return typeof invocation.input.command === "string"
}
