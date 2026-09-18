import type React from 'react'
import {
  type MotionValue,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import { useSmoothScroll } from './SmoothScroll.js'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import { cx } from '../../utils/cx.js'

// Snappy follow so the indicator trails the scroll quickly and smoothly without lag
const PROGRESS_SPRING = { stiffness: 400, damping: 35, mass: 0.2 }

type CommonProps = {
  /** Override the scroll source. Defaults to the page or container via useSmoothScroll. */
  progress?: MotionValue<number>
  /** Spring-smooth the value. Disabled automatically under reduced motion. Defaults to true. */
  spring?: boolean
  className?: string
  style?: React.CSSProperties
}

export interface ScrollProgressBarProps extends CommonProps {
  variant?: 'bar'
  position?: 'top' | 'bottom' | 'sticky'
  /** Bar thickness in px. Defaults to 2. */
  height?: number
  /** Position the bar with `fixed` (page) or `absolute` (embedded container). Defaults to true. Ignored when position is 'sticky'. */
  fixed?: boolean
}

export interface ScrollProgressCircleProps extends CommonProps {
  variant: 'circle'
  /** Diameter in px. Defaults to 40. */
  size?: number
  /** Stroke width in px. Defaults to 3. */
  thickness?: number
}

export type ScrollProgressProps =
  | ScrollProgressBarProps
  | ScrollProgressCircleProps

function useProgressValue(
  source: MotionValue<number> | undefined,
  spring: boolean,
): MotionValue<number> {
  const desktopPrefersReduced = usePrefersReducedMotion()
  const motionPrefersReduced = useReducedMotion()
  const reduce = desktopPrefersReduced || !!motionPrefersReduced

  const fallback = useSmoothScroll().progress
  const raw = source ?? fallback
  const smoothed = useSpring(raw, PROGRESS_SPRING)
  const chosen = spring && !reduce ? smoothed : raw
  return useTransform(chosen, v => Math.min(1, Math.max(0, v)))
}

export function ScrollProgressBar({
  progress,
  spring = true,
  position = 'top',
  height = 2,
  fixed = true,
  className,
  style,
}: ScrollProgressBarProps): React.ReactNode {
  const value = useProgressValue(progress, spring)
  const isSticky = position === 'sticky'
  const isBottom = position === 'bottom'

  return (
    <motion.div
      aria-hidden="true"
      className={cx(
        'scroll-progress-bar',
        isSticky
          ? 'scroll-progress-bar--sticky'
          : fixed
            ? 'scroll-progress-bar--fixed'
            : 'scroll-progress-bar--absolute',
        isBottom
          ? 'scroll-progress-bar--bottom'
          : 'scroll-progress-bar--top',
        className,
      )}
      style={{
        ...style,
        height,
        scaleX: value,
      }}
    />
  )
}

export function ScrollProgressCircle({
  progress,
  spring = true,
  size = 40,
  thickness = 3,
  className,
  style,
}: ScrollProgressCircleProps): React.ReactNode {
  const value = useProgressValue(progress, spring)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const offset = useTransform(value, (v: number) => circumference * (1 - v))

  return (
    <svg
      aria-hidden="true"
      className={cx('scroll-progress-circle', className)}
      focusable="false"
      height={size}
      role="presentation"
      style={style}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      <circle
        className="scroll-progress-circle__track"
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeWidth={thickness}
      />
      <motion.circle
        className="scroll-progress-circle__indicator"
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeLinecap="round"
        strokeWidth={thickness}
        style={{ strokeDashoffset: offset }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

export function ScrollProgress(props: ScrollProgressProps): React.ReactNode {
  if (props.variant === 'circle') {
    return <ScrollProgressCircle {...props} />
  }
  return <ScrollProgressBar {...props} />
}
