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
import type { DesktopBrowserState } from '../../../shared/types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { formatBrowserDisplayURL } from './browserDisplayURL.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'

type Props = {
  state: DesktopBrowserState
  onAppendAnnotation: (text: string) => void
  onAppendComposerText?: (text: string) => void
  onStateChange: (state: DesktopBrowserState) => void
}

type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function DesktopBrowserPanel({
  state,
  onAppendAnnotation,
  onAppendComposerText,
  onStateChange,
}: Props): React.ReactNode {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [address, setAddress] = useState(state.url)
  const [addressFocused, setAddressFocused] = useState(false)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [annotationTarget, setAnnotationTarget] = useState('')
  const [annotationBody, setAnnotationBody] = useState('')
  const lastBoundsRef = useRef<BrowserBounds | null>(null)

  useEffect(() => {
    if (state.url) {
      setAddress(state.url)
    }
  }, [state.url])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !state.open) return

    let animationFrame = 0
    const setBounds = (bounds: BrowserBounds): void => {
      const previous = lastBoundsRef.current
      if (previous && sameBrowserBounds(previous, bounds)) {
        return
      }

      lastBoundsRef.current = bounds
      void desktopClient
        .setBrowserBounds(bounds)
        .then(onStateChange)
        .catch(() => undefined)
    }

    const syncBounds = (): void => {
      if (!state.url) {
        setBounds({ x: 0, y: 0, width: 0, height: 0 })
        return
      }
      const rect = viewport.getBoundingClientRect()
      setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }

    const scheduleSyncBounds = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        syncBounds()
      })
    }

    syncBounds()
    const resizeObserver = new ResizeObserver(scheduleSyncBounds)
    resizeObserver.observe(viewport)
    window.addEventListener('resize', scheduleSyncBounds)
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      setBounds({ x: 0, y: 0, width: 0, height: 0 })
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleSyncBounds)
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

  function handleSendPageToComposer(): void {
    const url = state.url || address
    if (!url.trim()) return
    onAppendComposerText?.(
      [
        '浏览器页面：',
        `- 标题：${state.title || '未命名页面'}`,
        `- URL：${url}`,
      ].join('\n'),
    )
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
            disabled={!state.canGoBack}
            size="md"
            title="后退"
            variant="browser"
            onClick={() => void runBrowserAction(desktopClient.goBackBrowser)}
          >
            <ArrowLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            disabled={!state.canGoForward}
            size="md"
            title="前进"
            variant="browser"
            onClick={() => void runBrowserAction(desktopClient.goForwardBrowser)}
          >
            <ArrowRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton
            size="md"
            title="重新加载"
            variant="browser"
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
            disabled={!state.url && !address.trim()}
            size="md"
            title="发送当前页面到对话框"
            variant="browser"
            onClick={handleSendPageToComposer}
          >
            <MessageSquarePlus
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </IconButton>
          <IconButton
            size="md"
            title={annotationOpen ? '收起批注' : '添加批注'}
            variant="browser"
            onClick={() => setAnnotationOpen(current => !current)}
          >
            <MessageSquarePlus
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </IconButton>
          <IconButton size="md" title="更多" variant="browser">
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
          <Button
            onClick={() => setAnnotationOpen(current => !current)}
          >
            <MessageSquarePlus size={APP_ICON_SIZE} />
            <span>添加批注</span>
          </Button>
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
          <Button
            disabled={!annotationBody.trim()}
            onClick={handleSubmitAnnotation}
          >
            <Check size={APP_ICON_SIZE} />
            <span>插入输入框</span>
          </Button>
        </div>
      ) : null}
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
