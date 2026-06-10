import React, { useEffect, useRef, useState } from 'react'

type Props = {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}

type Hsv = {
  h: number
  s: number
  v: number
}

const FALLBACK_HEX = '#0169CC'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeHex(value: string): string {
  const trimmed = value.trim()
  const raw = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed

  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const expanded = raw
      .split('')
      .map((char) => char + char)
      .join('')
    return `#${expanded.toUpperCase()}`
  }

  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toUpperCase()}`
  }

  return FALLBACK_HEX
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex).slice(1)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((component) => component.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let hue = 0
  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6
    } else if (max === green) {
      hue = (blue - red) / delta + 2
    } else {
      hue = (red - green) / delta + 4
    }
    hue *= 60
    if (hue < 0) hue += 360
  }

  const saturation = max === 0 ? 0 : delta / max
  return {
    h: hue,
    s: saturation * 100,
    v: max * 100,
  }
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const saturation = s / 100
  const value = v / 100
  const chroma = value * saturation
  const hueSection = (h % 360) / 60
  const x = chroma * (1 - Math.abs((hueSection % 2) - 1))
  const match = value - chroma

  let red = 0
  let green = 0
  let blue = 0

  if (hueSection >= 0 && hueSection < 1) {
    red = chroma
    green = x
  } else if (hueSection < 2) {
    red = x
    green = chroma
  } else if (hueSection < 3) {
    green = chroma
    blue = x
  } else if (hueSection < 4) {
    green = x
    blue = chroma
  } else if (hueSection < 5) {
    red = x
    blue = chroma
  } else {
    red = chroma
    blue = x
  }

  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  }
}

function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHsv(r, g, b)
}

function hsvToHex(hsv: Hsv): string {
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v)
  return rgbToHex(r, g, b)
}

function getReadableTextColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.58 ? '#111827' : '#FFFFFF'
}

export function ColorPickerControl({ value, onChange, ariaLabel }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const squareRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))

  useEffect(() => {
    setHsv(hexToHsv(value))
  }, [value])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent): void {
      if (
        event.target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const selectedHex = hsvToHex(hsv)
  const buttonTextColor = getReadableTextColor(selectedHex)
  const swatchBorderColor =
    buttonTextColor === '#FFFFFF'
      ? 'rgba(255, 255, 255, 0.7)'
      : 'rgba(17, 24, 39, 0.2)'

  function commitColor(nextHsv: Hsv): void {
    setHsv(nextHsv)
    onChange(hsvToHex(nextHsv))
  }

  function updateSquareFromPointer(event: React.PointerEvent<HTMLDivElement>): void {
    const square = squareRef.current
    if (!square) return

    const rect = square.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const saturation = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100)
    const value = clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100)
    commitColor({ ...hsv, s: saturation, v: value })
  }

  function handleSquarePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    updateSquareFromPointer(event)
  }

  function handleSquarePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return
    updateSquareFromPointer(event)
  }

  function handleSquarePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleHueChange(event: React.ChangeEvent<HTMLInputElement>): void {
    commitColor({ ...hsv, h: Number(event.target.value) })
  }

  return (
    <div className="appearance-color-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="appearance-color-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
        style={{
          backgroundColor: selectedHex,
          color: buttonTextColor,
        }}
      >
        <span
          className="appearance-color-trigger-swatch"
          style={{
            backgroundColor: selectedHex,
            borderColor: swatchBorderColor,
          }}
        />
        <span className="appearance-color-trigger-value">{selectedHex}</span>
      </button>

      {open ? (
        <div className="appearance-color-popover" role="dialog" aria-label={ariaLabel}>
          <div
            ref={squareRef}
            className="appearance-color-square"
            onPointerDown={handleSquarePointerDown}
            onPointerMove={handleSquarePointerMove}
            onPointerUp={handleSquarePointerUp}
            onPointerCancel={handleSquarePointerUp}
            style={{
              backgroundImage: [
                'linear-gradient(to top, rgba(0, 0, 0, 1), rgba(0, 0, 0, 0))',
                `linear-gradient(to right, #FFFFFF, hsl(${Math.round(hsv.h)} 100% 50%))`,
              ].join(', '),
            }}
          >
            <div
              className="appearance-color-square-handle"
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`,
                backgroundColor: selectedHex,
              }}
            />
          </div>

          <input
            aria-label={`${ariaLabel ?? 'color'} hue`}
            className="appearance-color-hue"
            max={360}
            min={0}
            onChange={handleHueChange}
            step={1}
            type="range"
            value={Math.round(hsv.h)}
            style={{
              backgroundImage:
                'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
              color: selectedHex,
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
