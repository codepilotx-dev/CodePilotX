import type React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useLocation } from 'react-router-dom'
import { getChatHomeHeroTitle } from './chatHomeHero.js'
import { DesktopComposer } from './composer/DesktopComposer.js'
import { useQuickChatContext } from './QuickChatContext.js'

const CHAT_COMPOSER_PLACEHOLDER = '给 CodePilotX 发消息'

export function ChatNewSessionView(): React.ReactNode {
  const { composerProps } = useQuickChatContext()
  const location = useLocation()
  const prefersReducedMotion = useReducedMotion()
  const heroTitle = getChatHomeHeroTitle(location.key)

  return (
    <div className="quick-chat-workspace chat-home-workspace">
      <main className="quick-chat-view chat-home-view">
        <section className="quick-chat-composer-region chat-home-region">
          <div className="quick-chat-hero chat-home-hero">
            <motion.h1
              key={location.key}
              animate={{ opacity: 1, y: 0 }}
              initial={
                prefersReducedMotion ? false : { opacity: 0, y: 4 }
              }
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: 'easeOut' }
              }
            >
              {heroTitle}
            </motion.h1>
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
