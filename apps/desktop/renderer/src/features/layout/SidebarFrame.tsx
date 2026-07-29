import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Bot, History } from "lucide-react";
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { motion } from "motion/react";
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import {
  fastTween,
  motionTransition,
  standardTween,
} from '../motion/motionTransitions.js'
import {
  SIDEBAR_COLLAPSE_HOLD_MS,
  SIDEBAR_COLLAPSE_TARGET_SIZE,
  useSidebarResizeCollapseConfirm,
} from './useSidebarResizeCollapseConfirm.js'
import type { SidebarShellController } from './sidebarShellState.js'

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
  const sidebarRef = useRef<HTMLElement>(null);
  const reducedMotion = usePrefersReducedMotion()
  const labels = getSidebarContentLabels(contentKind)
  const {
    collapseConfirmKey,
    collapseConfirmTarget,
    handleResizeKey,
    resizing,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed: shell.mode === 'collapsed' && collapsed,
    maxWidth,
    minWidth,
    width,
    onCollapse,
    onSetWidth,
  });

  const floating = shell.mode === 'preview'
  const hidden = shell.mode === 'collapsed'
  const docked = shell.mode === 'docked'
  const previousHiddenRef = useRef(hidden)

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

  useLayoutEffect(() => {
    const roots = [sidebarRef.current].filter(
      (root): root is HTMLElement => root !== null,
    );
    if (roots.length === 0) return;

    const footerEntries = roots
      .map(root => ({
        footer: root.querySelector<HTMLElement>(".sidebar-footer"),
        root,
      }))
      .filter(
        (entry): entry is { footer: HTMLElement; root: HTMLElement } =>
          entry.footer !== null,
      );

    function updateFooterHeight(entry: {
      footer: HTMLElement;
      root: HTMLElement;
    }): void {
      const footerStyle = window.getComputedStyle(entry.footer);
      const height = Math.ceil(
        entry.footer.getBoundingClientRect().height +
          Number.parseFloat(footerStyle.marginTop || "0") +
          Number.parseFloat(footerStyle.marginBottom || "0"),
      );
      entry.root.style.setProperty("--sidebar-footer-height", `${height}px`);
    }

    footerEntries.forEach(updateFooterHeight);
    const observer = new ResizeObserver(entries => {
      for (const resizeEntry of entries) {
        const match = footerEntries.find(entry => entry.footer === resizeEntry.target);
        if (match) updateFooterHeight(match);
      }
    });
    footerEntries.forEach(entry => observer.observe(entry.footer));

    return () => observer.disconnect();
  }, [shell.mode]);

  return (
    <>
      <motion.div
        aria-hidden="true"
        animate={{ width: docked ? width : 0 }}
        className="desktop-sidebar-spacer"
        initial={false}
        transition={motionTransition(
          reducedMotion,
          docked ? standardTween : fastTween,
        )}
      />
      <motion.aside
        ref={sidebarRef}
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
        initial={
          hidden
            ? { opacity: 0, visibility: 'hidden', x: -8 }
            : false
        }
        inert={hidden ? true : undefined}
        style={{ "--sidebar-current-width": `${width}px` } as React.CSSProperties}
        transition={motionTransition(
          reducedMotion,
          hidden ? fastTween : standardTween,
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
          onPointerDown={startResize}
          role="separator"
          tabIndex={0}
        /> : null}
        <div className="icon-button sidebar-brand-floating">
          <Bot size={APP_ICON_SIZE} />
        </div>
        <History className="icon-button sidebar-history-watermark" size={APP_ICON_SIZE} />
      </motion.aside>
      {collapseConfirmTarget ? (
        <div
          key={collapseConfirmKey}
          aria-hidden="true"
          className="sidebar-collapse-confirm-target"
          style={{
            "--sidebar-collapse-target-ms": `${SIDEBAR_COLLAPSE_HOLD_MS}ms`,
            "--sidebar-collapse-target-size": `${SIDEBAR_COLLAPSE_TARGET_SIZE}px`,
            left: `${collapseConfirmTarget.x}px`,
            top: `${collapseConfirmTarget.y}px`,
          } as React.CSSProperties}
        />
      ) : null}
    </>
  );
}
