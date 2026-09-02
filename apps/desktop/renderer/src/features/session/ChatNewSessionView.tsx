import type React from 'react'
import { DesktopComposer } from './composer/DesktopComposer.js'
import { useQuickChatContext } from './QuickChatContext.js'

const CHAT_COMPOSER_PLACEHOLDER = '给 CodePilotX 发消息'

export function ChatNewSessionView(): React.ReactNode {
  const { composerProps } = useQuickChatContext()

  return (
    <div className="quick-chat-workspace chat-home-workspace">
      <main className="quick-chat-view chat-home-view">
        <section className="quick-chat-composer-region chat-home-region">
          <div className="quick-chat-hero chat-home-hero">
            <h1>随时可以开始。</h1>
          </div>
          {composerProps ? (
            <div className="chat-composer">
              <DesktopComposer
                {...composerProps}
                placeholder={CHAT_COMPOSER_PLACEHOLDER}
                surface="chat"
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}
