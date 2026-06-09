import React from 'react'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { runExtraUsage } from './extra-usage-core.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
): Promise<React.ReactNode | null> {
  const result = await runExtraUsage()

  if (result.type === 'message') {
    onDone(result.value)
    return null
  }

  onDone('OAuth login is disabled in this build. Set ANTHROPIC_API_KEY or configure provider credentials for additional usage.')
  return null
}
