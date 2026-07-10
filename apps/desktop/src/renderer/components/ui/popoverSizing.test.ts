import { expect, test } from 'bun:test'
import { buildPopoverSizingStyle, formatPopoverSize } from './popoverSizing.js'

test('formatPopoverSize converts numeric sizes to px', () => {
  expect(formatPopoverSize(320)).toBe('320px')
})

test('formatPopoverSize keeps CSS string sizes unchanged', () => {
  expect(formatPopoverSize('min(420px, 80vw)')).toBe('min(420px, 80vw)')
})

test('buildPopoverSizingStyle rejects missing widths', () => {
  expect(() => buildPopoverSizingStyle()).toThrow('Popover width is required')
})

test('buildPopoverSizingStyle accepts an explicit automatic width', () => {
  expect(buildPopoverSizingStyle({ width: 'auto' })).toEqual({
    '--popover-width': 'auto',
  })
})

test('buildPopoverSizingStyle writes width and maxWidth custom properties', () => {
  expect(buildPopoverSizingStyle({ width: 300, maxWidth: 'calc(100vw - 32px)' })).toEqual({
    '--popover-width': '300px',
    '--popover-max-width': 'calc(100vw - 32px)',
  })
})
