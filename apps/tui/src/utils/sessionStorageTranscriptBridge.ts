import type { Message } from '../types/message.js'
import { recordTranscript } from './sessionStorage.js'

export async function recordTranscriptMessages(
  messages: Message[],
): Promise<void> {
  await recordTranscript(messages)
}
