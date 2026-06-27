import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExitPlanModeApproval } from './ExitPlanModeApproval.js'
import type { DesktopPermissionRequest } from '../../../shared/types.js'

const request: DesktopPermissionRequest = {
  requestId: 'plan-1',
  toolName: 'ExitPlanMode',
  description: '确认计划',
  input: { plan: '# Plan' },
}

test('ExitPlanModeApproval matches compact plan confirmation layout', () => {
  const html = renderToStaticMarkup(
    <ExitPlanModeApproval
      request={request}
      onAccept={() => {}}
      onRevise={() => {}}
    />,
  )

  expect(html).toContain('实施此计划?')
  expect(html).toContain('是，实施此计划')
  expect(html).toContain('忽略')
  expect(html).toContain('ESC')
  expect(html).toContain('提交')
  expect(html.match(/请告知 Codex 如何调整/g)?.length).toBe(1)
  expect(html).not.toContain('后续权限')
  expect(html).not.toContain('查看计划摘要')
})
