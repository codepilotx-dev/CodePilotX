import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from 'react-router-dom'
import { Bot, History } from "lucide-react";
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { motion } from "motion/react";
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import { motionTransition, standardTween } from '../motion/motionTransitions.js'
import {
  SIDEBAR_COLLAPSE_HOLD_MS,
  SIDEBAR_COLLAPSE_TARGET_SIZE,
  useSidebarResizeCollapseConfirm,
} from './useSidebarResizeCollapseConfirm.js'
import type { SidebarShellController } from './sidebarShellState.js'

export type SidebarContentKind = 'tasks' | 'settings'

export function getSidebarContentLabels(contentKind: SidebarContentKind): {
  close: string
  preview: string
  resize: string
  sidebar: string
} {
  const name = contentKind === 'settings' ? '设置侧栏' : '任务侧栏'
  return {
    close: `关闭${name}`,
    preview: `预览${name}`,
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
  const drawerRestoreFocusRef = useRef<HTMLElement | null>(null)
  const location = useLocation()
  const reducedMotion = usePrefersReducedMotion()
  const labels = getSidebarContentLabels(contentKind)
  const {
    collapseConfirmKey,
    collapseConfirmTarget,
    handleResizeKey,
    resizing,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed,
    maxWidth,
    minWidth,
    width,
    onCollapse,
    onSetWidth,
  });

  useEffect(() => {
    shell.closeTransient()
  }, [location.pathname, shell.closeTransient])

  useEffect(() => {
    if (shell.mode === 'drawer') {
      drawerRestoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      window.requestAnimationFrame(() => {
        sidebarRef.current
          ?.querySelector<HTMLElement>(
            'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
          )
          ?.focus({ preventScroll: true })
      })
      return
    }
    const restoreTarget = drawerRestoreFocusRef.current
    drawerRestoreFocusRef.current = null
    restoreTarget?.focus({ preventScroll: true })
  }, [shell.mode])

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

  const floating = shell.mode === 'preview' || shell.mode === 'drawer'
  const hidden = shell.mode === 'collapsed'

  return (
    <>
      {shell.mode === 'docked' ? (
        <div
          aria-hidden="true"
          className="desktop-sidebar-spacer"
          style={{ "--sidebar-current-width": `${width}px` } as React.CSSProperties}
        />
      ) : null}
      {shell.canPreview && shell.mode === 'collapsed' ? (
        <div
          aria-label={labels.preview}
          className="sidebar-hover-zone"
          onBlur={shell.onTriggerBlur}
          onFocus={shell.onTriggerFocus}
          onPointerEnter={shell.onTriggerPointerEnter}
          onPointerOut={event => {
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ) {
              return
            }
            shell.onTriggerPointerLeave(
              event.currentTarget.contains(document.activeElement),
            )
          }}
          role="button"
          tabIndex={0}
        />
      ) : null}
      {shell.mode === 'drawer' ? (
        <button
          aria-label={labels.close}
          className="sidebar-drawer-backdrop"
          onClick={shell.closeTransient}
          type="button"
        />
      ) : null}
      <motion.aside
        ref={sidebarRef}
        aria-label={labels.sidebar}
        aria-hidden={hidden || undefined}
        className={[
          "desktop-sidebar",
          "tw:flex tw:h-full tw:shrink-0 tw:flex-col tw:overflow-hidden tw:bg-app-chrome tw:text-app-text",
          `is-${shell.mode}`,
          floating ? "is-floating" : "",
          resizing ? "is-resizing" : "",
        ].join(" ")}
        animate={{ opacity: hidden ? 0 : 1, x: hidden ? -12 : 0 }}
        data-sidebar-content={contentKind}
        initial={false}
        inert={hidden ? true : undefined}
        onBlur={shell.onSidebarBlur}
        onFocus={shell.onSidebarFocus}
        onKeyDown={event => {
          if (shell.mode !== 'drawer' || event.key !== 'Tab') return
          const focusable = [
            ...(sidebarRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            ) ?? []),
          ]
          if (focusable.length === 0) return
          const first = focusable[0]!
          const last = focusable.at(-1)!
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
        onPointerEnter={shell.onSidebarPointerEnter}
        onPointerOut={event => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return
          }
          shell.onSidebarPointerLeave(
            event.currentTarget.contains(document.activeElement),
          )
        }}
        style={{ "--sidebar-current-width": `${width}px` } as React.CSSProperties}
        transition={motionTransition(reducedMotion, standardTween)}
      >
        {children}

        {shell.mode === 'docked' ? <div
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
