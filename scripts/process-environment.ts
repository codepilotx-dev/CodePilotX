export function mergeProcessEnvironment(
  base: NodeJS.ProcessEnv,
  additions: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const merged = { ...base }
  for (const [key, value] of Object.entries(additions)) {
    const normalized = key.toLowerCase()
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === normalized) delete merged[existing]
    }
    merged[key] = value
  }
  return merged
}

export function createIsolatedProcessEnvironment(
  base: NodeJS.ProcessEnv,
  additions: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(base).filter(([key, value]) =>
      value !== undefined && !key.toLowerCase().startsWith("codepilotx_")),
  )
  return mergeProcessEnvironment(inherited, additions)
}
