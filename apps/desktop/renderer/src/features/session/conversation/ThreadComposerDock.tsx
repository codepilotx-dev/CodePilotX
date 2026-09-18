import type React from 'react'
import { forwardRef } from 'react'

import { ComposerFrame } from '../composer/ComposerSurface.js'

type ThreadComposerDockProps = {
  children: React.ReactNode
  style?: React.CSSProperties
}

/** Shared thread composer shell used by the main conversation and side chats. */
export const ThreadComposerDock = forwardRef<
  HTMLDivElement,
  ThreadComposerDockProps
>(function ThreadComposerDock({ children, style }, ref) {
  return (
    <div
      className="chat-composer workflow-page__composer tw:pointer-events-none tw:flex tw:w-full tw:justify-center"
      data-component="thread-composer-dock"
    >
      <ComposerFrame
        ref={ref}
        className="workflow-page__composer-inner"
        style={style}
      >
        {children}
      </ComposerFrame>
    </div>
  )
})
