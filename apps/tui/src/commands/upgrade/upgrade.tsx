import * as React from 'react'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { openBrowser } from '../../utils/browser.js'
import { logError } from '../../utils/log.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
): Promise<React.ReactNode | null> {
  try {
    const url = 'https://claude.ai/upgrade/max'
    await openBrowser(url)

    onDone(
      'Opened upgrade page. OAuth login is disabled in this build; set ANTHROPIC_API_KEY after upgrading.',
    )
    return null
  } catch (error) {
    logError(error as Error)
    setTimeout(
      onDone,
      0,
      'Failed to open browser. Please visit https://claude.ai/upgrade/max to upgrade.',
    )
  }
  return null
}
