export function fullErrorMessage(error: unknown): string {
  return formatUnknownError(error, new WeakSet<object>())
}

function formatUnknownError(error: unknown, seen: WeakSet<object>): string {
  if (error instanceof Error) return formatError(error, seen)
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') return stringifyObject(error, seen)
  return String(error)
}

function formatError(error: Error, seen: WeakSet<object>): string {
  if (seen.has(error)) return '[Circular Error]'
  seen.add(error)

  const primary =
    error.stack ||
    (error.message ? `${error.name}: ${error.message}` : String(error))
  const details = Object.entries(error).filter(([key]) => key !== 'cause')
  const extra =
    details.length > 0
      ? `\n${stringifyObject(Object.fromEntries(details), seen)}`
      : ''
  const cause =
    'cause' in error
      ? `\nCaused by: ${formatUnknownError(error.cause, seen)}`
      : ''

  return `${primary}${extra}${cause}`
}

function stringifyObject(value: object, seen: WeakSet<object>): string {
  try {
    return JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (!item || typeof item !== 'object') return item
        if (seen.has(item)) return '[Circular]'
        seen.add(item)
        if (item instanceof Error) {
          return {
            name: item.name,
            message: item.message,
            stack: item.stack,
            ...Object.fromEntries(
              Object.entries(item).filter(([key]) => key !== 'cause'),
            ),
            ...('cause' in item ? { cause: item.cause } : {}),
          }
        }
        return item
      },
      2,
    ) ?? String(value)
  } catch {
    return String(value)
  }
}
