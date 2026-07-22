import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SessionTimelineView } from '../src/features/session/SessionTimelineView.js'

test('renders dynamic conversation rows in normal document flow', () => {
  const html = renderToStaticMarkup(
    <SessionTimelineView count={2} scrollRef={React.createRef<HTMLElement>()}>
      <div className="session-turn-row">第一条</div>
      <div className="session-turn-row">第二条</div>
    </SessionTimelineView>,
  )

  expect(html).toContain('session-timeline-content')
  expect(html.match(/session-turn-row/g)).toHaveLength(2)
  expect(html).not.toContain('position:absolute')
  expect(html).not.toContain('data-index=')
})
