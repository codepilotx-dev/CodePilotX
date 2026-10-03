import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComposerDraftKey } from '../session/composer/composerTypes.js'
import { useBrowserAnnotations } from './useBrowserAnnotations.js'
import { ArrowLeft, ArrowRight, Globe2, MessageSquarePlus, Plus, RefreshCw } from 'lucide-react'
import type { DesktopBrowserState } from '../../../shared/types.js'
import type { DesktopBrowserClient } from '../../services/desktop-client/desktop-browser-client.js'
import { formatBrowserDisplayURL } from './browserDisplayURL.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/iconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { BrowserManagementControls } from './BrowserManagementControls.js'

type Props = {
  client: DesktopBrowserClient
  threadId?: string | null
  onNewTab?: () => void
  state: DesktopBrowserState
  draftKey: ComposerDraftKey
  onStateChange: (state: DesktopBrowserState) => void
  onOpenSettings?: () => void
  onAppendImage?: (image: { data: string; mimeType: 'image/png' }) => void
}

type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function DesktopBrowserPanel({
  state,
  client,
  onNewTab,
  draftKey,
  onStateChange,
  onOpenSettings,
  onAppendImage,
}: Props): React.ReactNode {
  const [barsHost, setBarsHost] = useState<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [address, setAddress] = useState(state.url)
  const [addressFocused, setAddressFocused] = useState(false)
  const annotation = useBrowserAnnotations(client, state, draftKey)
  const lastBoundsRef = useRef<BrowserBounds | null>(null)
  const syncBrowserBoundsRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    if (state.url) {
      setAddress(state.url)
    }
  }, [state.url])

  useEffect(() => client.onBrowserStateChange(onStateChange), [client, onStateChange])

  useEffect(() => {
    if (!client.available || !state.open) return
    void client
      .setBrowserVisible(true)
      .then(onStateChange)
      .catch(() => undefined)
  }, [client, onStateChange, state.open])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !state.open) return

    let animationFrame = 0
    const setBounds = async (bounds: BrowserBounds): Promise<void> => {
      const previous = lastBoundsRef.current
      if (previous && sameBrowserBounds(previous, bounds)) {
        return
      }

      lastBoundsRef.current = bounds
      try {
        const next = await client.setBrowserBounds(bounds)
        onStateChange(next)
      } catch {
        // Bounds synchronization is retried by the next resize or visibility change.
      }
    }

    const syncBounds = async (): Promise<void> => {
      if (!state.url) {
        await setBounds({ x: 0, y: 0, width: 0, height: 0 })
        return
      }
      const rect = viewport.getBoundingClientRect()
      await setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }
    syncBrowserBoundsRef.current = syncBounds

    const scheduleSyncBounds = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        void syncBounds()
      })
    }

    void syncBounds()
    const resizeObserver = new ResizeObserver(scheduleSyncBounds)
    resizeObserver.observe(viewport)
    window.addEventListener('resize', scheduleSyncBounds)
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      syncBrowserBoundsRef.current = async () => undefined
      void setBounds({ x: 0, y: 0, width: 0, height: 0 })
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleSyncBounds)
    }
  }, [client, onStateChange, state.open, state.url])

  async function runBrowserAction(action: () => Promise<DesktopBrowserState>): Promise<void> {
    try {
      const next = await action()
      onStateChange(next)
    } catch (error) {
      onStateChange({
        ...state,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function handleNavigate(): void {
    void runBrowserAction(() => client.navigateBrowser(address))
  }

  const compactAddress =
    !addressFocused && address === state.url ? formatBrowserDisplayURL(address) : address
  const addressStatus = state.error
    ? state.error
    : state.loading
      ? '加载中...'
      : state.title || state.url || '未打开页面'

  return (
    <section className="right-dock-browser" aria-label="内置浏览器">
      <div className="browser-commandbar">
        <div className="browser-navigation">
          <IconButton
            color="ghostSecondary"
            disabled={!state.canGoBack}
            size="toolbar"
            title="后退"
            onClick={() => void runBrowserAction(client.goBackBrowser)}
          >
            <ArrowLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            color="ghostSecondary"
            disabled={!state.canGoForward}
            size="toolbar"
            title="前进"
            onClick={() => void runBrowserAction(client.goForwardBrowser)}
          >
            <ArrowRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            color="ghostSecondary"
            size="toolbar"
            title={state.loading ? '停止加载' : '重新加载'}
            onClick={() =>
              void runBrowserAction(state.loading ? client.stopBrowser : client.reloadBrowser)
            }
          >
            <RefreshCw size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
        </div>
        <form
          className="browser-address-form"
          title={addressStatus}
          onSubmit={(event) => {
            event.preventDefault()
            handleNavigate()
          }}
        >
          <input
            aria-label="浏览器地址"
            placeholder="输入 URL"
            value={compactAddress}
            onBlur={() => setAddressFocused(false)}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => setAddressFocused(true)}
          />
          {state.loading ? <span className="browser-address-state">加载中</span> : null}
          {state.error ? <span className="browser-address-error">!</span> : null}
        </form>
        <div className="browser-toolbar-actions">
          {state.controlThreadId ? (
            <Button
              color="secondary"
              title="停止 Agent 操作，由你控制此标签"
              onClick={() => void runBrowserAction(() => client.control(null))}
            >
              接管
            </Button>
          ) : null}
          {state.busy ? <span className="browser-address-state">Agent 操作中</span> : null}
          <IconButton
            color="ghostSecondary"
            size="toolbar"
            title={annotation.active ? '退出批注' : '选择网页目标并添加批注'}
            className="browser-annotation-trigger"
            disabled={!state.features?.annotations || !state.documentId}
            aria-pressed={annotation.active}
            onClick={annotation.toggle}
          >
            <MessageSquarePlus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton color="ghostSecondary" size="toolbar" title="新标签页" onClick={onNewTab}>
            <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <BrowserManagementControls
            client={client}
            state={state}
            barsHost={barsHost}
            onOpenSettings={onOpenSettings}
            onAppendImage={onAppendImage}
          />
        </div>
      </div>
      <div ref={setBarsHost} className="browser-utility-bars" />
      {annotation.active ? (
        <div className="browser-annotation-tools" role="toolbar" aria-label="批注选择模式">
          <SegmentedControl
            value={annotation.mode}
            onChange={annotation.changeMode}
            ariaLabel="选择目标类型"
            options={[
              { value: 'element', label: '元素' },
              { value: 'text', label: '文本' },
              { value: 'region', label: '区域' },
            ]}
          />
          <span>
            {annotation.invalid.length
              ? `${annotation.invalid.length} 条目标已失效，反馈仍可发送`
              : '选择目标后填写反馈；Shift 多选；Esc 取消或退出'}
          </span>
          <Button color="secondary" onClick={annotation.toggle}>
            完成标注
          </Button>
        </div>
      ) : null}
      {annotation.error ? (
        <div className="browser-status-row" role="alert">
          {annotation.error}
        </div>
      ) : null}

      {state.error ? (
        <div className="browser-status-row" role="alert">
          <span>{state.error}</span>
          <Button
            color="secondary"
            disabled={!state.url && !address.trim()}
            type="button"
            onClick={() =>
              void runBrowserAction(
                state.url ? client.reloadBrowser : () => client.navigateBrowser(address),
              )
            }
          >
            重试
          </Button>
        </div>
      ) : null}

      <div
        className="browser-viewport"
        ref={viewportRef}
        onPointerDown={() => {
          if (client.available) {
            void client.focusBrowser().catch(() => undefined)
          }
        }}
      >
        {!state.url ? (
          <div className="browser-empty-state">
            <Globe2 size={APP_ICON_SIZES.lg} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <strong>开始浏览</strong>
            <span>输入 URL 以打开页面</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function sameBrowserBounds(a: BrowserBounds, b: BrowserBounds): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}
