import type { ToolInvocation } from "../domain"

export const isShellInvocation = (invocation: ToolInvocation) => {
  return invocation.name === "shell" && typeof invocation.input.command === "string"
}
