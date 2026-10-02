import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Bot, History } from "lucide-react";
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import {
  layoutTween,
  motionTransition,
} from '../motion/motionTransitions.js'
import {
  useSidebarResizeCollapseConfirm,
} from './useSidebarResizeCollapseConfirm.js'
import { useLiveResizeValue } from './useLiveResizeValue.js'
import type { SidebarShellController } from './sidebarShellState.js'
import { SIDEBAR_RAIL_WIDTH } from './sidebar/sidebarNavigation.js'

export type SidebarContentKind = 'tasks' | 'settings'

export function getSidebarContentLabels(contentKind: SidebarContentKind): {
  resize: string
  sidebar: string
} {
  const name = contentKind === 'settings' ? '设置侧栏' : '任务侧栏'
  return {
    resize: `调整${name}宽度`,
    sidebar: name,
  }
}

type Props = {
  rail?: React.ReactNode;
  children: React.ReactNode;
  collapsed: boolean;
  contentKind: SidebarContentKind;
  maxWidth: number;
  minWidth: number;
  width: number;
  onCollapse: () => void;
  onSetWidth: (width: number) => void;
  shell: SidebarShellController;
};

export function SidebarFrame({
  rail,
  children,
  collapsed,
  contentKind,
  maxWidth,
  minWidth,
  width,
  onCollapse,
  onSetWidth,
  shell,
}: Props): React.ReactNode {
  const modern = rail != null
  const railWidth = modern ? SIDEBAR_RAIL_WIDTH : 0
  const sidebarRef = useRef<HTMLElement>(null);
  const reducedMotion = usePrefersReducedMotion()
  const labels = getSidebarContentLabels(contentKind)
  const {
    liveSize: liveWidth,
    liveSizePixels: liveWidthPixels,
    previewSize: previewWidth,
  } = useLiveResizeValue(width)

  const {
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerMove,
    handlePointerUp,
    handleResizeKey,
    resizing,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed: shell.mode === 'collapsed' && collapsed,
    maxWidth,
    minWidth,
    width,
    collapseBehavior: {
      kind: 'threshold',
      threshold: minWidth / 2,
    },
    onCollapse,
    onResizePreview: previewWidth,
    onSetWidth,
  });

  const floating = shell.mode === 'preview'
  const hidden = shell.mode === 'collapsed' || (modern && shell.pane === null)
  const docked = modern ? shell.dockedVisible : shell.mode === 'docked'
  const transition = modern ? { ...layoutTween, duration: floating ? 0.12 : 0.3 } : layoutTween
  const dockedRef = useRef(docked)
  dockedRef.current = docked
  const allocatedWidth = useMotionValue(docked ? width : railWidth)
  const allocatedWidthAnimationRef =
    useRef<ReturnType<typeof animate> | null>(null)
  const previousHiddenRef = useRef(hidden)

  useMotionValueEvent(liveWidth, 'change', nextWidth => {
    if (!dockedRef.current) return
    allocatedWidthAnimationRef.current?.stop()
    allocatedWidthAnimationRef.current = null
    allocatedWidth.set(nextWidth)
  })

  useEffect(() => {
    const animation = animate(
      allocatedWidth,
      docked ? liveWidth.get() : railWidth,
      motionTransition(
        reducedMotion,
        transition,
      ),
    )
    allocatedWidthAnimationRef.current = animation
    return () => {
      animation.stop()
      if (allocatedWidthAnimationRef.current === animation) {
        allocatedWidthAnimationRef.current = null
      }
    }
  }, [allocatedWidth, docked, liveWidth, reducedMotion, modern, floating, railWidth])

  useLayoutEffect(() => {
    const wasHidden = previousHiddenRef.current
    previousHiddenRef.current = hidden
    if (!hidden || wasHidden) return

    const activeElement = document.activeElement
    if (
      !(activeElement instanceof HTMLElement)
      || !sidebarRef.current?.contains(activeElement)
    ) return
    document
      .querySelector<HTMLElement>('[data-app-shell-sidebar-trigger]')
      ?.focus({ preventScroll: true })
  }, [hidden])

  useEffect(() => {
    const active = floating && resizing
    shell.onFloatingResizeChange(active)
    return () => {
      if (active) shell.onFloatingResizeChange(false)
    }
  }, [floating, resizing, shell.onFloatingResizeChange])

  return (
    <>
      {modern ? <div className="desktop-sidebar-rail-slot" data-sidebar-layout="modern">{rail}</div> : null}
      <motion.div
        aria-hidden="true"
        className="desktop-sidebar-spacer"
        style={{ width: allocatedWidth }}
      />
      <motion.aside
        id="desktop-sidebar-pane"
        ref={sidebarRef}
        onClick={modern ? event => {
          if (event.target instanceof Element && event.target.closest('a[href], .sidebar-timeline-toggle-button')) shell.pin()
        } : undefined}
        aria-label={labels.sidebar}
        aria-hidden={hidden || undefined}
        className={[
          "desktop-sidebar",
          "tw:flex tw:h-full tw:shrink-0 tw:flex-col tw:overflow-hidden tw:text-app-text",
          `is-${shell.mode}`,
          floating ? "is-floating" : "",
          resizing ? "is-resizing" : "",
        ].join(" ")}
        animate={
          hidden
            ? {
                opacity: 0,
                x: -8,
                transitionEnd: { visibility: 'hidden' },
              }
            : {
                opacity: 1,
                visibility: 'visible',
                x: 0,
              }
        }
        data-sidebar-content={contentKind}
        data-sidebar-layout={modern ? 'modern' : 'classic'}
        data-sidebar-pane={modern ? shell.pane : undefined}
        initial={
          hidden
            ? { opacity: 0, visibility: 'hidden', x: -8 }
            : false
        }
        inert={hidden ? true : undefined}
        style={
          {
            "--sidebar-current-width": liveWidthPixels,
            "--sidebar-rail-width": `${railWidth}px`,
          } as unknown as React.CSSProperties
        }
        transition={motionTransition(
          reducedMotion,
          transition,
        )}
      >
        {children}

        {shell.mode === 'docked' || shell.mode === 'preview' ? <div
          aria-label={labels.resize}
          aria-orientation="vertical"
          aria-valuemax={maxWidth}
          aria-valuemin={minWidth}
          aria-valuenow={width}
          className="sidebar-resizer"
          onKeyDown={handleResizeKey}
          onLostPointerCapture={handleLostPointerCapture}
          onPointerCancel={handlePointerCancel}
          onPointerDown={startResize}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          role="separator"
          tabIndex={0}
        /> : null}
        <div className="icon-button sidebar-brand-floating">
          <Bot size={APP_ICON_SIZE} />
        </div>
        <History className="icon-button sidebar-history-watermark" size={APP_ICON_SIZE} />
      </motion.aside>
    </>
  );
}
