import { beforeAll, describe, expect, test } from 'bun:test'

function makeButton(rect: {
  left: number
  right: number
  top: number
}): HTMLElement {
  const el = document.createElement('button')
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.top + 24,
      width: rect.right - rect.left,
      height: 24,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  })
  return el
}

function mockViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
}

let anchorPopoverToButton: typeof import('./popoverAnchor.js').anchorPopoverToButton

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerWidth: 1280 },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: ((tag: string) => {
      if (typeof tag === 'string' && tag.toLowerCase() === 'button') {
        return Object.create(null) as HTMLElement
      }
      throw new Error(`unexpected tag ${tag}`)
    }) },
  })
  ;({ anchorPopoverToButton } = await import('./popoverAnchor.js'))
})

describe('anchorPopoverToButton', () => {
  test('returns null when anchor is missing', () => {
    expect(anchorPopoverToButton(null, 200)).toBeNull()
  })

  test('places popover to the right of the anchor when space allows', () => {
    mockViewport(1280)
    const button = makeButton({ left: 400, right: 420, top: 100 })
    const position = anchorPopoverToButton(button, 300)
    expect(position).not.toBeNull()
    expect(position?.side).toBe('right')
    expect(position?.left).toBe(420 + 8)
  })

  test('flips to the left side when the right side would overflow the viewport', () => {
    mockViewport(800)
    const button = makeButton({ left: 700, right: 720, top: 100 })
    const position = anchorPopoverToButton(button, 300)
    expect(position).not.toBeNull()
    expect(position?.side).toBe('left')
    expect(position?.left).toBe(700 - 300 - 8)
  })

  test('clamps to the viewport when both sides would overflow', () => {
    mockViewport(250)
    const button = makeButton({ left: 0, right: 20, top: 100 })
    const position = anchorPopoverToButton(button, 300)
    expect(position).not.toBeNull()
    expect(position?.left).toBe(8)
  })
})