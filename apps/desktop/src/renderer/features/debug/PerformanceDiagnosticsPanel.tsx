import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Activity, Clock, Gauge } from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'

type FrameStats = {
  fps: number
  longestFrameMs: number
  longFrames: number
  sampleCount: number
}

const SAMPLE_WINDOW_MS = 1000
const LONG_FRAME_MS = 50

export function PerformanceDiagnosticsPanel(): React.ReactNode {
  const [stats, setStats] = useState<FrameStats>({
    fps: 0,
    longestFrameMs: 0,
    longFrames: 0,
    sampleCount: 0,
  })
  const statsRef = useRef({
    frames: 0,
    lastFrameAt: 0,
    longestFrameMs: 0,
    longFrames: 0,
    windowStartedAt: 0,
  })

  useEffect(() => {
    let frame = 0
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
        setStats({
          fps: Math.round((current.frames * 1000) / elapsed),
          longestFrameMs: Math.round(current.longestFrameMs),
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

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <section className="performance-diagnostics-panel" aria-label="性能诊断">
      <div className="performance-diagnostics-header">
        <h3>性能诊断</h3>
        <p className="performance-diagnostics-summary">
          基于 requestAnimationFrame 的本地采样，仅在调试模式显示。
        </p>
      </div>
      <div className="performance-diagnostics-grid">
        <StatCard
          icon={<Gauge size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
          label="FPS"
          value={stats.fps ? String(stats.fps) : '采样中'}
        />
        <StatCard
          icon={<Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
          label="最长帧"
          value={`${stats.longestFrameMs}ms`}
        />
        <StatCard
          icon={<Activity size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
          label="长帧"
          value={String(stats.longFrames)}
        />
      </div>
      <p className="performance-diagnostics-footnote">
        长帧阈值：{LONG_FRAME_MS}ms；当前窗口样本：{stats.sampleCount} 帧。
      </p>
    </section>
  )
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
      <strong className="performance-diagnostics-stat-value">{value}</strong>
    </div>
  )
}
