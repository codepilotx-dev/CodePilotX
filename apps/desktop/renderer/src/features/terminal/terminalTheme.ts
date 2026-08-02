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
    background: cssColor(styles, '--color-token-terminal-background'),
    foreground: cssColor(styles, '--color-token-terminal-foreground'),
    cursor: cssColor(styles, '--color-token-terminal-foreground'),
    selectionBackground: cssColor(styles, '--color-token-editor-selection-background'),
    black: cssColor(styles, '--color-token-terminal-ansi-black'),
    red: cssColor(styles, '--color-token-terminal-ansi-red'),
    green: cssColor(styles, '--color-token-terminal-ansi-green'),
    yellow: cssColor(styles, '--color-token-terminal-ansi-yellow'),
    blue: cssColor(styles, '--color-token-terminal-ansi-blue'),
    magenta: cssColor(styles, '--color-token-terminal-ansi-magenta'),
    cyan: cssColor(styles, '--color-token-terminal-ansi-cyan'),
    white: cssColor(styles, '--color-token-terminal-ansi-white'),
    brightBlack: cssColor(styles, '--color-token-terminal-ansi-bright-black'),
    brightRed: cssColor(styles, '--color-token-terminal-ansi-bright-red'),
    brightGreen: cssColor(styles, '--color-token-terminal-ansi-bright-green'),
    brightYellow: cssColor(styles, '--color-token-terminal-ansi-bright-yellow'),
    brightBlue: cssColor(styles, '--color-token-terminal-ansi-bright-blue'),
    brightMagenta: cssColor(styles, '--color-token-terminal-ansi-bright-magenta'),
    brightCyan: cssColor(styles, '--color-token-terminal-ansi-bright-cyan'),
    brightWhite: cssColor(styles, '--color-token-terminal-ansi-bright-white'),
  }
}

export function readTerminalFont(element: Element): TerminalFont {
  const styles = getComputedStyle(element)
  return {
    fontFamily: cssColor(styles, '--font-family-mono'),
    fontSize: parseTerminalFontSize(cssColor(styles, '--font-size-code')),
  }
}

export function parseTerminalFontSize(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_FONT_SIZE
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, parsed))
}
