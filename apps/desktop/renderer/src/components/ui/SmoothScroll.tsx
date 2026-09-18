import type Lenis from 'lenis'
import { ReactLenis, useLenis, type LenisRef } from 'lenis/react'
import {
  type MotionValue,
  useMotionValue,
  useReducedMotion,
} from 'motion/react'
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { ArrowUp } from 'lucide-react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import { cx } from '../../utils/cx.js'
import { IconButton } from './IconButton.js'
import { APP_ICON_SIZE } from './iconTokens.js'

// Lenis canonical smooth-scroll easing fn (expo-out curve)
const EASE_SCROLL = (t: number): number => Math.min(1, 1.001 - 2 ** (-10 * t))

export type ScrollTarget = number | string | HTMLElement

export type ScrollToOptions = {
  offset?: number
  immediate?: boolean
  duration?: number
}

export type SmoothScrollApi = {
  /** Underlying Lenis instance, or null on the reduced-motion / native path. */
  lenis: Lenis | null
  /** Current scroll offset in px. */
  scrollY: MotionValue<number>
  /** Scroll position as 0..1 of the scrollable height. */
  progress: MotionValue<number>
  /** Signed scroll velocity (px/frame); drives velocity-based effects. */
  velocity: MotionValue<number>
  /** Programmatic smooth scroll. Respects reduced motion (jumps instantly). */
  scrollTo: (target: ScrollTarget, options?: ScrollToOptions) => void
}

const SmoothScrollContext = createContext<SmoothScrollApi | null>(null)

export interface SmoothScrollProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'dir' | 'color'> {
  children: ReactNode
  /** Drive the page (window) when true, or a contained scroll area when false. Defaults to true. */
  root?: boolean
  /** Smoothing factor (between 0 and 1); higher is faster and snappier, lower is heavier. Defaults to 0.2. */
  lerp?: number
  /** Wheel / programmatic ease duration in seconds. Defaults to 0.25 (250ms snappy response). */
  duration?: number
  orientation?: 'vertical' | 'horizontal'
  /** Wheel scroll speed multiplier. Defaults to 1.2 for responsive tracking. */
  wheelMultiplier?: number
  /** Smooth touch scrolling. Off by default. */
  touch?: boolean
  className?: string
  style?: React.CSSProperties
  viewportRef?: React.Ref<HTMLDivElement>
}

type ScrollSource = Window | HTMLElement

function readMetrics(target: ScrollSource): { y: number; max: number } {
  if (target instanceof Window) {
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    )
    return { y: window.scrollY, max }
  }
  return {
    y: target.scrollTop,
    max: Math.max(0, target.scrollHeight - target.clientHeight),
  }
}

function resolveTop(
  target: ScrollTarget,
  source: ScrollSource,
  offset = 0,
): number {
  if (typeof target === 'number') return target + offset
  if (source instanceof Window) {
    const el =
      typeof target === 'string' ? document.querySelector(target) : target
    if (!el) return window.scrollY
    return el.getBoundingClientRect().top + window.scrollY + offset
  }
  const el = typeof target === 'string' ? source.querySelector(target) : target
  if (!(el instanceof HTMLElement)) return source.scrollTop
  return el.offsetTop + offset
}

/** Pushes Lenis' live scroll state into the shared motion values. */
function LenisBridge({
  scrollY,
  progress,
  velocity,
  lenisRef,
}: {
  scrollY: MotionValue<number>
  progress: MotionValue<number>
  velocity: MotionValue<number>
  lenisRef: React.MutableRefObject<Lenis | null>
}): null {
  const lenis = useLenis(instance => {
    scrollY.set(instance.scroll)
    progress.set(instance.progress)
    velocity.set(instance.velocity)
  })

  useEffect(() => {
    lenisRef.current = lenis ?? null
    return () => {
      lenisRef.current = null
    }
  }, [lenis, lenisRef])

  return null
}

/** Native scroll listener for the reduced-motion path and the no-provider fallback. */
function useNativeScrollSync(
  enabled: boolean,
  getTarget: () => ScrollSource | null,
  scrollY: MotionValue<number>,
  progress: MotionValue<number>,
  velocity: MotionValue<number>,
): void {
  useEffect(() => {
    if (!enabled) return
    const target = getTarget()
    if (!target) return
    let lastY = readMetrics(target).y
    let lastT = performance.now()
    const onScroll = (): void => {
      const { y, max } = readMetrics(target)
      const now = performance.now()
      const dt = now - lastT || 16
      scrollY.set(y)
      progress.set(max > 0 ? y / max : 0)
      velocity.set(((y - lastY) / dt) * 16)
      lastY = y
      lastT = now
    }
    onScroll()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [enabled, getTarget, scrollY, progress, velocity])
}

export const SmoothScroll = forwardRef<HTMLDivElement, SmoothScrollProps>(
  function SmoothScroll(
    {
      children,
      root = true,
      lerp = 0.2,
      duration = 0.25,
      orientation = 'vertical',
      wheelMultiplier = 1.2,
      touch = false,
      className,
      style,
      viewportRef,
      ...rest
    },
    forwardedRef,
  ): React.ReactNode {
    const desktopPrefersReduced = usePrefersReducedMotion()
    const motionPrefersReduced = useReducedMotion()
    const reduce = desktopPrefersReduced || !!motionPrefersReduced

    const scrollY = useMotionValue(0)
    const progress = useMotionValue(0)
    const velocity = useMotionValue(0)
    const lenisRef = useRef<Lenis | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const lenisComponentRef = useRef<LenisRef | null>(null)

    useImperativeHandle(forwardedRef, () => {
      if (reduce) return containerRef.current as HTMLDivElement
      return (lenisComponentRef.current?.wrapper ??
        containerRef.current) as HTMLDivElement
    })

    useEffect(() => {
      const el = reduce
        ? containerRef.current
        : lenisComponentRef.current?.wrapper ?? null
      if (!viewportRef) return
      if (typeof viewportRef === 'function') {
        viewportRef(el)
      } else if ('current' in viewportRef) {
        ;(viewportRef as React.MutableRefObject<HTMLDivElement | null>).current =
          el
      }
      return () => {
        if (typeof viewportRef === 'function') {
          viewportRef(null)
        } else if (viewportRef && 'current' in viewportRef) {
          ;(viewportRef as React.MutableRefObject<HTMLDivElement | null>).current =
            null
        }
      }
    }, [reduce, viewportRef])

    const nativeSource = useCallback(
      (): ScrollSource | null =>
        root
          ? window
          : reduce
            ? containerRef.current
            : lenisComponentRef.current?.wrapper ?? null,
      [root, reduce],
    )

    const scrollTo = useCallback(
      (target: ScrollTarget, options?: ScrollToOptions) => {
        const lenis = lenisRef.current
        if (lenis && !reduce) {
          lenis.scrollTo(target, {
            offset: options?.offset,
            duration: options?.duration,
            immediate: options?.immediate,
          })
          return
        }
        const source = nativeSource()
        const behavior = reduce || options?.immediate ? 'auto' : 'smooth'
        const top = resolveTop(target, source ?? window, options?.offset)
        ;(source ?? window).scrollTo({ top, behavior })
      },
      [reduce, nativeSource],
    )

    useNativeScrollSync(!!reduce, nativeSource, scrollY, progress, velocity)

    const api = useMemo<SmoothScrollApi>(
      () => ({
        lenis: lenisRef.current,
        scrollY,
        progress,
        velocity,
        scrollTo,
      }),
      [scrollY, progress, velocity, scrollTo],
    )

    useEffect(() => {
      const lenis = lenisRef.current
      if (!lenis) return
      lenis.resize()
    }, [children])

    const rootClassName = cx(
      'scroll-area',
      'smooth-scroll',
      root
        ? 'smooth-scroll--root'
        : 'smooth-scroll--contained u-overflow-y-auto u-overflow-hidden u-h-full u-min-h-0 u-w-full u-min-w-0',
      className,
    )

    if (reduce) {
      return (
        <SmoothScrollContext.Provider value={api}>
          <div
            ref={containerRef}
            className={rootClassName}
            style={style}
            {...rest}
          >
            {children}
          </div>
        </SmoothScrollContext.Provider>
      )
    }

    return (
      <SmoothScrollContext.Provider value={api}>
        <ReactLenis
          ref={lenisComponentRef}
          className={rootClassName}
          options={{
            lerp,
            duration,
            orientation,
            wheelMultiplier,
            smoothWheel: true,
            syncTouch: touch,
            easing: EASE_SCROLL,
          }}
          root={root}
          style={style}
          {...rest}
        >
          <LenisBridge
            lenisRef={lenisRef}
            progress={progress}
            scrollY={scrollY}
            velocity={velocity}
          />
          {children}
        </ReactLenis>
      </SmoothScrollContext.Provider>
    )
  },
)

/**
 * Read the scroll state. Inside <SmoothScroll> it returns shared motion values;
 * outside it falls back to a native scroll listener.
 */
export function useSmoothScroll(): SmoothScrollApi {
  const ctx = useContext(SmoothScrollContext)
  const scrollY = useMotionValue(0)
  const progress = useMotionValue(0)
  const velocity = useMotionValue(0)
  const windowSource = useCallback((): ScrollSource => window, [])

  useNativeScrollSync(ctx === null, windowSource, scrollY, progress, velocity)

  const scrollTo = useCallback(
    (target: ScrollTarget, options?: ScrollToOptions) => {
      window.scrollTo({
        top: resolveTop(target, window, options?.offset),
        behavior: options?.immediate ? 'auto' : 'smooth',
      })
    },
    [],
  )

  const fallback = useMemo<SmoothScrollApi>(
    () => ({ lenis: null, scrollY, progress, velocity, scrollTo }),
    [scrollY, progress, velocity, scrollTo],
  )

  return ctx ?? fallback
}

/** Convenience button to smoothly scroll to the top of the container / window. */
export function ScrollTopButton({
  className,
  title = '回到顶部',
}: {
  className?: string
  title?: string
}): React.ReactNode {
  const { scrollTo } = useSmoothScroll()

  return (
    <IconButton
      className={cx('scroll-top-button', className)}
      color="ghostSecondary"
      size="icon"
      title={title}
      type="button"
      onClick={() => scrollTo(0)}
    >
      <ArrowUp size={APP_ICON_SIZE} />
    </IconButton>
  )
}
