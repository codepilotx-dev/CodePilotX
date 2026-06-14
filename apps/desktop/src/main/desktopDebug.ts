export function desktopDebug(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const suffix =
    Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : ''
  console.info(`[desktop-debug] ${new Date().toISOString()} ${event}${suffix}`)
}
