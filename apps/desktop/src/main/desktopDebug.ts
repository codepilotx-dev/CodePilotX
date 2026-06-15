let stdoutPipeBroken = false

export function desktopDebug(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (stdoutPipeBroken) return

  const suffix =
    Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : ''
  try {
    process.stdout.write(
      `[desktop-debug] ${new Date().toISOString()} ${event}${suffix}\n`,
    )
  } catch (error) {
    if (isBrokenPipeError(error)) {
      stdoutPipeBroken = true
      return
    }
    throw error
  }
}

process.stdout.on('error', error => {
  if (isBrokenPipeError(error)) {
    stdoutPipeBroken = true
  }
})

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')
  )
}
