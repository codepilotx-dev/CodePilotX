import {
  useMotionTemplate,
  useMotionValue,
  type MotionValue,
} from 'motion/react'
import { useCallback, useLayoutEffect, useRef } from 'react'

export type LiveResizeValue = {
  liveSize: MotionValue<number>
  liveSizePixels: MotionValue<string>
  previewSize: (nextSize: number | null) => void
}

export function normalizeLiveResizeSize(
  size: number,
  pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio,
): number {
  const safePixelRatio = Number.isFinite(pixelRatio)
    ? Math.max(1, pixelRatio)
    : 1
  return Math.round(size * safePixelRatio) / safePixelRatio
}

export function useLiveResizeValue(committedSize: number): LiveResizeValue {
  const committedSizeRef = useRef(committedSize)
  const previewingRef = useRef(false)
  const initialSize = normalizeLiveResizeSize(committedSize)
  const liveSize = useMotionValue(initialSize)
  const liveSizePixels = useMotionTemplate`${liveSize}px`

  useLayoutEffect(() => {
    const normalizedSize = normalizeLiveResizeSize(committedSize)
    committedSizeRef.current = normalizedSize
    if (!previewingRef.current && liveSize.get() !== normalizedSize) {
      liveSize.set(normalizedSize)
    }
  }, [committedSize, liveSize])

  const previewSize = useCallback(
    (nextSize: number | null): void => {
      if (nextSize === null) {
        if (!previewingRef.current) return
        previewingRef.current = false
        const committed = committedSizeRef.current
        if (liveSize.get() !== committed) liveSize.set(committed)
        return
      }

      previewingRef.current = true
      const normalizedSize = normalizeLiveResizeSize(nextSize)
      if (liveSize.get() !== normalizedSize) liveSize.set(normalizedSize)
    },
    [liveSize],
  )

  return {
    liveSize,
    liveSizePixels,
    previewSize,
  }
}
