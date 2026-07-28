import type React from 'react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Activity, Clock, Gauge, MemoryStick, Timer } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { cx } from '../../utils/cx.js'
import {
  enablePerformanceDiagnostics,
  getPerformanceDiagnosticsSnapshot,
  recordFrameWindow,
  recordHeapSample,
  recordLongTask,
  resetPerformanceDiagnostics,
  serializePerformanceDiagnosticsSnapshot,
  subscribePerformanceDiagnostics,
} from './performanceDiagnosticsStore.js'

const SAMPLE_WINDOW_MS = 1000
const LONG_FRAME_MS = 50

export function PerformanceDiagnosticsPanel(): React.ReactNode {
  const stats = useSyncExternalStore(
    subscribePerformanceDiagnostics,
    getPerformanceDiagnosticsSnapshot,
    getPerformanceDiagnosticsSnapshot,
  )
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef(0)
  const statsRef = useRef({
    frames: 0,
    lastFrameAt: 0,
    longestFrameMs: 0,
    longFrames: 0,
    windowStartedAt: 0,
  })

  useEffect(() => {
    const disable = enablePerformanceDiagnostics()
    let frame = 0
    let heapTimer = 0
    let longTaskObserver: PerformanceObserver | undefined

    const tick = (now: number): void => {
      const current = statsRef.current
      if (current.windowStartedAt === 0) {
        current.windowStartedAt = now
        current.lastFrameAt = now
      }

      const delta = now - current.lastFrameAt
      current.lastFrameAt = now
      current.frames += 1
      current.longestFrameMs = Math.max(current.longestFrameMs, delta)
      if (delta >= LONG_FRAME_MS) current.longFrames += 1

      const elapsed = now - current.windowStartedAt
      if (elapsed >= SAMPLE_WINDOW_MS) {
        recordFrameWindow({
          fps: Math.round((current.frames * 1000) / elapsed),
          longestFrameMs: current.longestFrameMs,
          longFrames: current.longFrames,
          sampleCount: current.frames,
        })
        current.frames = 0
        current.longestFrameMs = 0
        current.longFrames = 0
        current.windowStartedAt = now
      }

      frame = window.requestAnimationFrame(tick)
    }

    const sampleHeap = (): void => {
      const memory = (
        performance as Performance & {
          memory?: {
            usedJSHeapSize: number
            totalJSHeapSize: number
          }
        }
      ).memory
      if (!memory) return
      recordHeapSample({
        usedBytes: memory.usedJSHeapSize,
        totalBytes: memory.totalJSHeapSize,
      })
    }

    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ) {
      longTaskObserver = new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) {
          recordLongTask(entry.duration, entry.startTime)
        }
      })
      longTaskObserver.observe({ entryTypes: ['longtask'] })
    }

    sampleHeap()
    heapTimer = window.setInterval(sampleHeap, SAMPLE_WINDOW_MS)
    frame = window.requestAnimationFrame(tick)
    return () => {
      disable()
      window.cancelAnimationFrame(frame)
      window.clearInterval(heapTimer)
      window.clearTimeout(copiedTimerRef.current)
      longTaskObserver?.disconnect()
    }
  }, [])

  const copySnapshot = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        serializePerformanceDiagnosticsSnapshot(),
      )
      setCopied(true)
      window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="performance-diagnostics-panel" aria-label="性能诊断">
      <div className="performance-diagnostics-panel-content">
        <div className="performance-diagnostics-header">
          <h3 className={cx('u-m-0', 'u-text-primary', 'u-type-control', 'u-font-label')}>
            性能诊断
          </h3>
          <p className="performance-diagnostics-summary">
            仅在此面板打开时采集；数据只保存在内存中，不包含会话内容或标识。
          </p>
        </div>
        <div className={cx('u-flex', 'u-items-center', 'u-gap-2')}>
          <Button onClick={resetPerformanceDiagnostics}>重置</Button>
          <Button onClick={() => void copySnapshot()}>
            {copied ? '已复制' : '复制诊断快照'}
          </Button>
        </div>
        <div className="performance-diagnostics-grid">
          <StatCard
            icon={<Gauge size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="FPS"
            value={stats.frames.fps ? String(stats.frames.fps) : '采样中'}
          />
          <StatCard
            icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="最长帧"
            value={`${stats.frames.longestFrameMs}ms`}
          />
          <StatCard
            icon={<Activity size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="长帧"
            value={String(stats.frames.longFrames)}
          />
          <StatCard
            icon={<Timer size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="Long Task"
            value={`${stats.longTasks.count} / ${formatMs(stats.longTasks.longestMs)}`}
          />
          <StatCard
            icon={<Activity size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="SSE"
            value={`${stats.sse.eventsPerSecond}/s`}
          />
          <StatCard
            icon={<Activity size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="SSE 流量"
            value={`${formatBytes(stats.sse.bytesPerSecond)}/s`}
          />
          <StatCard
            icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="首 Delta p95"
            value={formatMs(stats.firstDeltaMs.p95)}
          />
          <StatCard
            icon={<Gauge size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="Batch 事件 p50/p95/max"
            value={formatDistribution(stats.canonical.eventsPerBatch)}
          />
          <StatCard
            icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="Apply p50/p95/max"
            value={formatDistribution(stats.canonical.applyMs, 'ms')}
          />
          <StatCard
            icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="Projection p95"
            value={formatMs(stats.canonical.projectionMs.p95)}
          />
          <StatCard
            icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="React commit p95"
            value={formatMs(stats.reactCommitMs.p95)}
          />
          <StatCard
            icon={<Activity size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="Live event IDs"
            value={String(stats.canonical.liveEventIds)}
          />
          <StatCard
            icon={<MemoryStick size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="JS Heap"
            value={
              stats.heap.usedBytes === null
                ? '不可用'
                : `${formatBytes(stats.heap.usedBytes)} / ${formatBytes(stats.heap.totalBytes ?? 0)}`
            }
          />
          <StatCard
            icon={<MemoryStick size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="Heap 趋势"
            value={
              stats.heap.usedDeltaBytes === null
                ? '采样中'
                : formatSignedBytes(stats.heap.usedDeltaBytes)
            }
          />
          <StatCard
            icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="切换骨架屏 p95"
            value={formatMs(stats.conversationSwitch.skeletonMs.p95)}
          />
          <StatCard
            icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="切换就绪 p95"
            value={formatMs(stats.conversationSwitch.canonicalReadyMs.p95)}
          />
          <StatCard
            icon={<Activity size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="切换初始 Turn/Item p95"
            value={`${formatNumber(stats.conversationSwitch.initialTurns.p95)}/${formatNumber(stats.conversationSwitch.initialItems.p95)}`}
          />
          <StatCard
            icon={<Activity size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="切换请求 p95"
            value={`read ${formatNumber(stats.conversationSwitch.threadReadsPerSwitch.p95)} · history ${formatNumber(stats.conversationSwitch.historyReadsPerSwitch.p95)} · workspace ${formatNumber(stats.conversationSwitch.workspaceRefreshesPerSwitch.p95)}`}
          />
          <StatCard
            icon={<Timer size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
            label="切换 Long Task p95"
            value={formatNumber(stats.conversationSwitch.longTasksPerSwitch.p95)}
          />
        </div>
        <p className="performance-diagnostics-footnote">
          长帧阈值：{LONG_FRAME_MS}ms；当前窗口样本：{stats.frames.sampleCount} 帧。
          SSE 范围：{formatBreakdown(stats.sse.byScope)}。
        </p>
        <p className="performance-diagnostics-footnote">
          SSE 类型：{formatBreakdown(stats.sse.byEventType)}。分位数使用最近 60 秒、
          最多 512 个样本。
        </p>
      </div>
    </section>
  )
}

function formatMs(value: number): string {
  return `${formatNumber(value)}ms`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatDistribution(
  value: { p50: number; p95: number; max: number },
  suffix = '',
): string {
  return `${formatNumber(value.p50)}/${formatNumber(value.p95)}/${formatNumber(value.max)}${suffix}`
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${Math.round(value)}B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)}KB`
  return `${(value / 1_048_576).toFixed(1)}MB`
}

function formatSignedBytes(value: number): string {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${prefix}${formatBytes(Math.abs(value))}`
}

function formatBreakdown(values: Readonly<Record<string, number>>): string {
  const entries = Object.entries(values).sort((left, right) => right[1] - left[1])
  return entries.length > 0
    ? entries.map(([name, count]) => `${name} ${count}`).join('、')
    : '暂无'
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}): React.ReactNode {
  return (
    <div className="performance-diagnostics-stat">
      <span className="performance-diagnostics-stat-icon">{icon}</span>
      <span className="performance-diagnostics-stat-label">{label}</span>
      <strong
        className={cx(
          'performance-diagnostics-stat-value',
          'u-text-primary',
          'u-type-title-md',
          'u-font-heading',
        )}
      >
        {value}
      </strong>
    </div>
  )
}
