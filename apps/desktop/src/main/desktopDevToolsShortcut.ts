export type DesktopInputShortcut = {
  type?: string
  key?: string
  code?: string
}

export function isDevToolsShortcut(input: DesktopInputShortcut): boolean {
  return (
    input.type === 'keyDown' &&
    (input.key === 'F12' || input.code === 'F12')
  )
}
