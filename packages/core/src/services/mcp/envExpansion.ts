/**
 * Expand environment variables in a string value.
 *
 * Supports `${VAR_NAME}` and `${VAR_NAME:-default}` syntax.
 * - `:-default`: if the env var is not set, use the default value.
 *   The default can contain `:-` itself (split on first occurrence only).
 *
 * @returns The expanded string and a list of variable names that were
 *   referenced but neither set nor given a default.
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []
  const expanded = value.replace(
    /\$\{([^}]+)\}/g,
    (_match, expression: string) => {
      const [varName, ...defaultParts] = expression.split(':-')
      const defaultValue = defaultParts.join(':-') // rejoin in case default contains :-
      const envValue = process.env[varName]
      if (envValue !== undefined) {
        return envValue
      }
      if (defaultValue) {
        return defaultValue
      }
      missingVars.push(varName)
      return _match // Preserve original reference
    },
  )
  return { expanded, missingVars }
}

/**
 * Expand environment variables in an MCP server config.
 */
export function expandEnvVars<T extends Record<string, unknown>>(
  config: T,
  expandString: (value: string) => { expanded: string; missingVars: string[] } = expandEnvVarsInString,
): {
  expanded: T
  missingVars: string[]
} {
  const missingVars: string[] = []

  function expandStringValue(str: string): string {
    const { expanded, missingVars: vars } = expandString(str)
    missingVars.push(...vars)
    return expanded
  }

  const expanded = deepExpandStrings(config, expandStringValue) as T
  return { expanded, missingVars }
}

function deepExpandStrings(
  value: unknown,
  expandFn: (str: string) => string,
): unknown {
  if (typeof value === 'string') {
    return expandFn(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => deepExpandStrings(item, expandFn))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepExpandStrings(val, expandFn)
    }
    return result
  }
  return value
}
