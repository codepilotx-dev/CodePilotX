export async function executeBlockedTransition(
  note: string | null,
  transition: (note: string) => Promise<void>,
): Promise<boolean> {
  const trimmed = note?.trim()
  if (!trimmed) return false
  await transition(trimmed)
  return true
}
