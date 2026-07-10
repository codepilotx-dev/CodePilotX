import { describe, it, expect } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerStatusOverlay } from './ComposerStatusOverlay.js'
import type { DesktopContextUsage } from '../../../shared/types.js'

describe('ComposerStatusOverlay', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <ComposerStatusOverlay
        open={false}
        onClose={() => {}}
        routedSessionId="sess-123"
        contextUsage={null}
      />,
    )
    expect(html).toBe('')
  })

  it('renders session ID when open', () => {
    const html = renderToStaticMarkup(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId="sess-abc-123"
        contextUsage={null}
      />,
    )
    expect(html).toContain('状态')
    expect(html).toContain('sess-abc-123')
  })

  it('shows fallback when no session ID', () => {
    const html = renderToStaticMarkup(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId={null}
        contextUsage={null}
      />,
    )
    expect(html).toContain('尚未创建会话')
  })

  it('shows context usage data when available', () => {
    const contextUsage: DesktopContextUsage = {
      model: 'gpt-4',
      contextWindow: 128000,
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      reasoningTokens: 0,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 0,
      usedTokens: 1500,
      remainingTokens: 126500,
      usedPercent: 1.17,
      remainingPercent: 98.83,
    }
    const html = renderToStaticMarkup(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId="sess-1"
        contextUsage={contextUsage}
      />,
    )
    expect(html).toContain('上下文用量')
    expect(html).toContain('1,500 / 128,000')
  })

  it('shows no-context placeholder when null', () => {
    const html = renderToStaticMarkup(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId="sess-1"
        contextUsage={null}
      />,
    )
    expect(html).toContain('暂无上下文统计')
  })
})
