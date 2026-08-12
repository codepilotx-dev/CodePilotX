import type React from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useLocation } from 'react-router-dom'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import {
  enterTween,
  exitTween,
  motionTransition,
} from '../motion/motionTransitions.js'
import { getChatHomeHeroTitle } from './chatHomeHero.js'
import { DesktopComposer } from './composer/DesktopComposer.js'
import { useQuickChatContext } from './QuickChatContext.js'

const CHAT_COMPOSER_PLACEHOLDER = '给 CodePilotX 发消息'

export function ChatNewSessionView(): React.ReactNode {
  const { composerProps } = useQuickChatContext()
  const location = useLocation()
  const reducedMotion = usePrefersReducedMotion()
  const heroTitle = getChatHomeHeroTitle(location.key)

  return (
    <div className="quick-chat-workspace chat-home-workspace">
      <main className="quick-chat-view chat-home-view">
        <section className="quick-chat-composer-region chat-home-region">
          <div className="quick-chat-hero chat-home-hero">
            <AnimatePresence initial={false} mode="wait">
              <ChatHeadingPresence
                key={location.key}
                reducedMotion={reducedMotion}
              >
                {heroTitle}
              </ChatHeadingPresence>
            </AnimatePresence>
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

function ChatHeadingPresence({
  children,
  reducedMotion,
}: {
  children: React.ReactNode
  reducedMotion: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()

  return (
    <motion.h1
      animate={{ opacity: 1, y: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      data-presence={isPresent ? 'present' : 'exiting'}
      exit={{
        opacity: 0,
        y: -4,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, y: 4 }}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      {children}
    </motion.h1>
  )
}
