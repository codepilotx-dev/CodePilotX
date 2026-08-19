import type { ITheme } from '@xterm/xterm'

export type TerminalFont = {
  fontFamily: string
  fontSize: number
}

const DEFAULT_TERMINAL_FONT_SIZE = 12
const MIN_TERMINAL_FONT_SIZE = 8
const MAX_TERMINAL_FONT_SIZE = 24

function cssColor(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim()
}

export function readTerminalTheme(element: Element): ITheme {
  const styles = getComputedStyle(element)
  return {
    background: cssColor(styles, '--cpx-comp-terminal-bg'),
    foreground: cssColor(styles, '--cpx-comp-terminal-fg'),
    cursor: cssColor(styles, '--cpx-comp-terminal-fg'),
    selectionBackground: cssColor(styles, '--cpx-sys-color-selected'),
    black: cssColor(styles, '--cpx-comp-terminal-ansi-black'),
    red: cssColor(styles, '--cpx-comp-terminal-ansi-red'),
    green: cssColor(styles, '--cpx-comp-terminal-ansi-green'),
    yellow: cssColor(styles, '--cpx-comp-terminal-ansi-yellow'),
    blue: cssColor(styles, '--cpx-comp-terminal-ansi-blue'),
    magenta: cssColor(styles, '--cpx-comp-terminal-ansi-magenta'),
    cyan: cssColor(styles, '--cpx-comp-terminal-ansi-cyan'),
    white: cssColor(styles, '--cpx-comp-terminal-ansi-white'),
    brightBlack: cssColor(styles, '--cpx-comp-terminal-ansi-bright-black'),
    brightRed: cssColor(styles, '--cpx-comp-terminal-ansi-bright-red'),
    brightGreen: cssColor(styles, '--cpx-comp-terminal-ansi-bright-green'),
    brightYellow: cssColor(styles, '--cpx-comp-terminal-ansi-bright-yellow'),
    brightBlue: cssColor(styles, '--cpx-comp-terminal-ansi-bright-blue'),
    brightMagenta: cssColor(styles, '--cpx-comp-terminal-ansi-bright-magenta'),
    brightCyan: cssColor(styles, '--cpx-comp-terminal-ansi-bright-cyan'),
    brightWhite: cssColor(styles, '--cpx-comp-terminal-ansi-bright-white'),
  }
}

export function readTerminalFont(element: Element): TerminalFont {
  const styles = getComputedStyle(element)
  return {
    fontFamily: cssColor(styles, '--cpx-sys-font-family-mono'),
    fontSize: parseTerminalFontSize(cssColor(styles, '--cpx-sys-font-size-code')),
  }
}

export function parseTerminalFontSize(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_FONT_SIZE
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, parsed))
}
