import type React from 'react'
import type { DesktopContextUsage } from '../../../../shared/types.js'
import { formatCompactNumber } from '../../../utils/usageFormatters.js'
import {
  CONTEXT_USAGE_BREAKDOWN_LABELS,
  buildContextUsageBreakdownSegments,
  contextUsageSegmentColor,
  formatCacheHitRate,
  formatPercentValue,
} from './contextUsageBreakdown.js'

type Props = {
  contextUsage: DesktopContextUsage | null
}

/**
 * 上下文容量面板：标题行 + 总量 + 进度条 + 来源分类行 + 平均缓存命中率。
 * Composer 圆环浮层与 /status 弹层共用，避免两处各画一套。
 */
export function ContextUsagePanel({ contextUsage }: Props): React.ReactNode {
  if (!contextUsage) {
    return <div className="context-usage-panel-empty">暂无上下文统计</div>
  }

  const usedPercent = Math.min(100, Math.max(0, contextUsage.usedPercent ?? 0))
  const segments = buildContextUsageBreakdownSegments(contextUsage.breakdown)
  const cacheHitRate = formatCacheHitRate(contextUsage.averageCacheHitRate)
  const detail = contextUsageDetail(contextUsage)
  const totalLabel = `${formatCompactNumber(contextUsage.usedTokens)}/${formatCompactNumber(
    contextUsage.contextWindow,
  )} (${formatPercentValue(usedPercent / 100)})`

  return (
    <div className="context-usage-panel">
      <div className="context-usage-panel-header">
        <span className="context-usage-panel-title">上下文容量</span>
        <span className="context-usage-panel-total">{totalLabel}</span>
      </div>
      <div className="context-usage-panel-track">
        {segments.length > 0 ? (
          segments.map((segment, index) => (
            <span
              className="context-usage-panel-segment"
              key={segment.source}
              style={{
                width: formatPercentValue(segment.percent),
                background: contextUsageSegmentColor(index),
              }}
            />
          ))
        ) : (
          // 旧会话没有分类数据时退化成单色占用条。
          <span className="context-usage-panel-fill" style={{ width: `${usedPercent}%` }} />
        )}
      </div>
      {segments.length > 0 ? (
        <div className="context-usage-panel-rows">
          {segments.map((segment, index) => (
            <div className="context-usage-panel-row" key={segment.source}>
              <span
                className="context-usage-panel-dot"
                style={{ background: contextUsageSegmentColor(index) }}
              />
              <span className="context-usage-panel-label">
                {CONTEXT_USAGE_BREAKDOWN_LABELS[segment.source]}
              </span>
              <span className="context-usage-panel-value">
                {formatPercentValue(segment.percent)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {cacheHitRate ? (
        <div className="context-usage-panel-row context-usage-panel-divider">
          <span className="context-usage-panel-label">平均缓存命中率</span>
          <span className="context-usage-panel-value">{cacheHitRate}</span>
        </div>
      ) : null}
      {detail ? <div className="context-usage-panel-detail">{detail}</div> : null}
    </div>
  )
}

/** 缓存的读写明细：只在下发过缓存数据时出现，作为面板最下方的一行补充。 */
function contextUsageDetail(contextUsage: DesktopContextUsage): string | null {
  const cacheRead = contextUsage.promptCacheReadTokens ?? 0
  const cacheWrite = contextUsage.promptCacheWriteTokens ?? 0
  const uncached = contextUsage.promptUncachedTokens ?? 0
  const reasoning = contextUsage.reasoningTokens ?? 0
  const parts: string[] = []
  if (cacheRead + cacheWrite + uncached > 0) {
    parts.push(
      `缓存 读 ${formatCompactNumber(cacheRead)}`,
      `写 ${formatCompactNumber(cacheWrite)}`,
      `未缓存 ${formatCompactNumber(uncached)}`,
    )
  }
  if (reasoning > 0) parts.push(`推理 ${formatCompactNumber(reasoning)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
