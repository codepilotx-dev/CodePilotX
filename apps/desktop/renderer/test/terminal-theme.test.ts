import { describe, expect, test } from 'bun:test'
import {
  parseTerminalFontSize,
  readTerminalFont,
} from '../src/features/terminal/terminalTheme.js'

describe('terminal theme', () => {
  test('parses the code font size with a 12px default and 8-24px bounds', () => {
    expect(parseTerminalFontSize('')).toBe(12)
    expect(parseTerminalFontSize('not-a-size')).toBe(12)
    expect(parseTerminalFontSize('7px')).toBe(8)
    expect(parseTerminalFontSize('13.5px')).toBe(13.5)
    expect(parseTerminalFontSize('30px')).toBe(24)
  })

  test('reads the appearance code font variables without a terminal-specific fallback', () => {
    const originalGetComputedStyle = globalThis.getComputedStyle
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({
        getPropertyValue: (name: string) =>
          name === '--font-family-mono'
            ? 'JetBrains Mono'
            : name === '--font-size-code'
              ? '15px'
              : '',
      }),
    })

    try {
      expect(readTerminalFont({} as Element)).toEqual({
        fontFamily: 'JetBrains Mono',
        fontSize: 15,
      })
    } finally {
      if (originalGetComputedStyle) {
        Object.defineProperty(globalThis, 'getComputedStyle', {
          configurable: true,
          value: originalGetComputedStyle,
        })
      } else {
        Reflect.deleteProperty(globalThis, 'getComputedStyle')
      }
    }
  })
})
