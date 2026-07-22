import type { ToolInvocation } from "../domain";

export const isShellInvocation = (invocation: ToolInvocation) => {
  return (
    (invocation.name === "Bash" || invocation.name === "PowerShell") &&
    typeof invocation.input.command === "string"
  );
};
