import type React from 'react'
import { Box, Info } from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import type { PhaseTimelineItem } from './timelineModel.js'

export function timelineItemSlot(item: PhaseTimelineItem): string {
  if (item.type === 'message' || item.type === 'assistant_delta') {
    return `${item.role ?? 'system'}-message`
  }
  return item.type
}

export function TimelineSystemNotice({
  content,
  type,
}: {
  content: string
  type?: string
}): React.ReactNode {
  if (isModelSwitchNotice(content)) {
    return (
      <article className="timeline-model-switch-event">
        <span className="timeline-model-switch-line" />
        <span className="timeline-model-switch-content">
          <Box size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <strong>{content}</strong>
          <Info size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </span>
        <span className="timeline-model-switch-line" />
      </article>
    )
  }

  return (
    <article className={`timeline-system-event ${type ?? 'message'}`}>
      {content}
    </article>
  )
}

function isModelSwitchNotice(content: string): boolean {
  return /^模型已从 .+ 更改为 .+$/.test(content.trim())
}
