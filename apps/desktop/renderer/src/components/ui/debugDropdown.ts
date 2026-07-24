export type PreventableOutsideEvent = {
  preventDefault: () => void
}

export function preventOutsideDismissWhenDebug(
  debugMode: boolean,
  event: PreventableOutsideEvent,
): void {
  if (debugMode) {
    event.preventDefault()
  }
}
