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

export function useLiveResizeValue(committedSize: number): LiveResizeValue {
  const committedSizeRef = useRef(committedSize)
  const previewingRef = useRef(false)
  const liveSize = useMotionValue(committedSize)
  const liveSizePixels = useMotionTemplate`${liveSize}px`

  useLayoutEffect(() => {
    committedSizeRef.current = committedSize
    if (!previewingRef.current) {
      liveSize.set(committedSize)
    }
  }, [committedSize, liveSize])

  const previewSize = useCallback(
    (nextSize: number | null): void => {
      if (nextSize === null) {
        previewingRef.current = false
        liveSize.set(committedSizeRef.current)
        return
      }

      previewingRef.current = true
      liveSize.set(nextSize)
    },
    [liveSize],
  )

  return {
    liveSize,
    liveSizePixels,
    previewSize,
  }
}
