import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { swapStatusText } from '../../startup/statusTextSwap.js'

export type FullScreenWhaleLoadingProps = {
  label: string
}

/**
 * 唯一的 Renderer 整窗鲸鱼加载组件：与 index.html 静态启动遮罩共用
 * `.full-screen-whale-loader` DOM/CSS 契约（56px 鲸鱼、2200ms 扫光、单行
 * 状态窗）。文案只随真实加载阶段变化，旧文案上滑、新文案从下方滑入；
 * 快速连续更新合并到最新状态，reduced-motion 下直接替换。
 */
export function FullScreenWhaleLoading({
  label,
}: FullScreenWhaleLoadingProps): React.ReactNode {
  const statusRef = useRef<HTMLSpanElement | null>(null)
  const latestLabelRef = useRef(label)
  const [displayedLabel, setDisplayedLabel] = useState(label)

  latestLabelRef.current = label

  useEffect(() => {
    if (displayedLabel === label) return
    const element = statusRef.current
    if (!element) return
    swapStatusText(element, label, () => {
      setDisplayedLabel(latestLabelRef.current)
    })
  }, [displayedLabel, label])

  return (
    <main
      className="full-screen-whale-loader"
      data-full-screen-loading="true"
      data-loading-label={label}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
    >
      <div className="full-screen-whale-loader__content">
        <div className="full-screen-whale-loader__logo" aria-hidden="true">
          <img
            className="full-screen-whale-loader__base"
            src="/whale-icon.svg"
            alt=""
          />
          <div className="full-screen-whale-loader__overlay" />
        </div>
        <div className="full-screen-whale-loader__status-viewport">
          <span ref={statusRef}>{displayedLabel}</span>
        </div>
      </div>
    </main>
  )
}
