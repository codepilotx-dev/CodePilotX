export function isDictationShortcut(event: Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'keyCode' | 'shiftKey'
>): boolean {
  return !event.isComposing
    && event.keyCode !== 229
    && event.ctrlKey
    && event.shiftKey
    && !event.altKey
    && event.key.toLowerCase() === 'd'
}
