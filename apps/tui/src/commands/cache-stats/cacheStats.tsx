import * as React from 'react'
import { getCacheStatsSnapshot } from '../../cost-tracker.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { formatNumber } from '../../utils/format.js'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function fmtUSD(amount: number): string {
  if (amount < 0.005) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

export const call: LocalJSXCommandCall = (onDone) => {
  const snapshot = getCacheStatsSnapshot(20)
  const { recent, totals } = snapshot

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      tabIndex={0}
      autoFocus
      onKeyDown={e => {
        if (
          e.key === 'escape' ||
          e.key === 'return' ||
          e.key === ' ' ||
          (e.ctrl && (e.key === 'c' || e.key === 'd'))
        ) {
          e.preventDefault()
          onDone(undefined, { display: 'skip' })
        }
      }}
    >
      <Box marginBottom={1}>
        <Text color="remember" bold>
          Prompt cache stats
        </Text>
        <Text dimColor> · 最近 {recent.length} 次请求</Text>
      </Box>

      {recent.length === 0 ? (
        <Text dimColor>当前会话尚无 API 请求记录</Text>
      ) : (
        <>
          <Box>
            <Text dimColor>{'时间'.padEnd(10)}</Text>
            <Text dimColor>{'模型'.padEnd(28)}</Text>
            <Text dimColor>{'prompt'.padStart(10)}</Text>
            <Text dimColor>{'命中'.padStart(10)}</Text>
            <Text dimColor>{'命中率'.padStart(10)}</Text>
            <Text dimColor>{'output'.padStart(10)}</Text>
          </Box>
          {recent.map((entry, i) => {
            const denom = entry.promptTokens + entry.cacheHitTokens
            const hitRate = denom > 0 ? entry.cacheHitTokens / denom : 0
            return (
              <Box key={i}>
                <Text>{fmtTime(entry.timestamp).padEnd(10)}</Text>
                <Text>{entry.model.padEnd(28)}</Text>
                <Text>{formatNumber(entry.promptTokens).padStart(10)}</Text>
                <Text color="green">
                  {formatNumber(entry.cacheHitTokens).padStart(10)}
                </Text>
                <Text color={hitRate > 0.5 ? 'green' : 'warning'}>
                  {fmtPct(hitRate).padStart(10)}
                </Text>
                <Text>{formatNumber(entry.outputTokens).padStart(10)}</Text>
              </Box>
            )
          })}
        </>
      )}

      {recent.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text>
            累计 prompt: {formatNumber(totals.promptTokens)} · 命中:{' '}
            <Text color="green">{formatNumber(totals.cacheHitTokens)}</Text> ·
            output: {formatNumber(totals.outputTokens)}
          </Text>
          <Text>
            命中率:{' '}
            <Text color={totals.hitRate > 0.5 ? 'green' : 'warning'}>
              {fmtPct(totals.hitRate)}
            </Text>
            {totals.cacheHitTokens > 0 && (
              <>
                {' · '}估算节省:{' '}
                <Text color="green">{fmtUSD(totals.estimatedSavingsUSD)}</Text>
                <Text dimColor> (可比指标，跨 provider 单价不同)</Text>
              </>
            )}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>按 Esc / Enter 关闭</Text>
      </Box>
    </Box>
  )
}
