import type { UUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import { linkSessionToPR } from '../../utils/sessionStorage.js'

export async function linkCurrentSessionToPR(prInfo: {
  prNumber: number
  prUrl: string
  prRepository: string
}): Promise<void> {
  const sessionId = getSessionId()
  if (!sessionId) {
    return
  }

  await linkSessionToPR(
    sessionId as UUID,
    prInfo.prNumber,
    prInfo.prUrl,
    prInfo.prRepository,
  )
}
