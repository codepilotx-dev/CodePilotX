export function applyDesktopAgentRuntimeEnvDefaults(
  env: Record<string, string | undefined> = process.env,
): void {
  env.USE_BUILTIN_RIPGREP = '0'
}
