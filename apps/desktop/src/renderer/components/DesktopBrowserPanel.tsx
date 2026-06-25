import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe2,
  MessageSquarePlus,
  MoreVertical,
  RefreshCw,
} from 'lucide-react'
import type { DesktopBrowserState } from '../../shared/types.js'
import { desktopClient } from '../services/desktopClient.js'
import { formatBrowserDisplayURL } from './browserDisplayURL.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './ui/iconTokens.js'
import { IconButton } from './ui/IconButton.js'

type Props = {
  state: DesktopBrowserState
  onAppendAnnotation: (text: string) => void
  onStateChange: (state: DesktopBrowserState) => void
}

export function DesktopBrowserPanel({
  state,
  onAppendAnnotation,
  onStateChange,
}: Props): React.ReactNode {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [address, setAddress] = useState(state.url)
  const [addressFocused, setAddressFocused] = useState(false)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [annotationTarget, setAnnotationTarget] = useState('')
  const [annotationBody, setAnnotationBody] = useState('')

  useEffect(() => {
    if (state.url) {
      setAddress(state.url)
    }
  }, [state.url])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !state.open) return

    const syncBounds = (): void => {
      if (!state.url) {
        void desktopClient
          .setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 })
          .then(onStateChange)
          .catch(() => undefined)
        return
      }
      const rect = viewport.getBoundingClientRect()
      void desktopClient
        .setBrowserBounds({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        })
        .then(onStateChange)
        .catch(() => undefined)
    }

    syncBounds()
    const resizeObserver = new ResizeObserver(syncBounds)
    resizeObserver.observe(viewport)
    window.addEventListener('resize', syncBounds)
    return () => {
      void desktopClient
        .setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 })
        .then(onStateChange)
        .catch(() => undefined)
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [onStateChange, state.open, state.url])

  async function runBrowserAction(
    action: () => Promise<DesktopBrowserState>,
  ): Promise<void> {
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
    void runBrowserAction(() => desktopClient.navigateBrowser(address))
  }

  function handleSubmitAnnotation(): void {
    const body = annotationBody.trim()
    if (!body) return
    const target = annotationTarget.trim()
    const lines = [
      '浏览器批注：',
      `- 页面：${state.title || '未命名页面'}`,
      `- URL：${state.url || address}`,
      target ? `- 位置：${target}` : null,
      `- 反馈：${body}`,
    ].filter(Boolean)
    onAppendAnnotation(lines.join('\n'))
    setAnnotationBody('')
    setAnnotationTarget('')
    setAnnotationOpen(false)
  }

  const compactAddress =
    !addressFocused && address === state.url
      ? formatBrowserDisplayURL(address)
      : address
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
            className="browser-icon-button"
            disabled={!state.canGoBack}
            title="后退"
            onClick={() => void runBrowserAction(desktopClient.goBackBrowser)}
          >
            <ArrowLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            className="browser-icon-button"
            disabled={!state.canGoForward}
            title="前进"
            onClick={() => void runBrowserAction(desktopClient.goForwardBrowser)}
          >
            <ArrowRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            className="browser-icon-button"
            title="重新加载"
            onClick={() => void runBrowserAction(desktopClient.reloadBrowser)}
          >
            <RefreshCw size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
        </div>
        <form
          className="browser-address-form"
          title={addressStatus}
          onSubmit={event => {
            event.preventDefault()
            handleNavigate()
          }}
        >
          <input
            aria-label="浏览器地址"
            placeholder="输入 URL"
            value={compactAddress}
            onBlur={() => setAddressFocused(false)}
            onChange={event => setAddress(event.target.value)}
            onFocus={() => setAddressFocused(true)}
          />
          {state.loading ? <span className="browser-address-state">加载中</span> : null}
          {state.error ? <span className="browser-address-error">!</span> : null}
        </form>
        <div className="browser-toolbar-actions">
          <IconButton
            className="browser-icon-button"
            title={annotationOpen ? '收起批注' : '添加批注'}
            onClick={() => setAnnotationOpen(current => !current)}
          >
            <MessageSquarePlus
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </IconButton>
          <IconButton className="browser-icon-button" title="更多">
            <MoreVertical size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
        </div>
      </div>

      <div className="browser-viewport" ref={viewportRef}>
        {!state.url ? (
          <div className="browser-empty-state">
            <Globe2 size={86} strokeWidth={1.6} />
            <strong>开始浏览</strong>
            <span>输入 URL 以打开页面</span>
          </div>
        ) : null}
      </div>

      {annotationOpen ? (
        <div className="browser-annotation-bar">
          <button
            className="browser-annotation-toggle"
            type="button"
            onClick={() => setAnnotationOpen(current => !current)}
          >
            <MessageSquarePlus size={APP_ICON_SIZE} />
            <span>添加批注</span>
          </button>
        </div>
      ) : null}

      {annotationOpen ? (
        <div className="browser-annotation-form">
          <input
            aria-label="批注位置"
            placeholder="位置或元素描述，例如 顶部导航按钮"
            value={annotationTarget}
            onChange={event => setAnnotationTarget(event.target.value)}
          />
          <textarea
            aria-label="批注内容"
            placeholder="描述需要调整的视觉问题"
            rows={3}
            value={annotationBody}
            onChange={event => setAnnotationBody(event.target.value)}
          />
          <button
            disabled={!annotationBody.trim()}
            type="button"
            onClick={handleSubmitAnnotation}
          >
            <Check size={APP_ICON_SIZE} />
            <span>插入输入框</span>
          </button>
        </div>
      ) : null}
    </section>
  )
}
