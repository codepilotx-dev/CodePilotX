import type React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

type Props = {
  contentKey: string
  windowChrome: React.ReactNode
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function DesktopAppShell({
  contentKey,
  windowChrome,
  sidebar,
  children,
}: Props): React.ReactNode {
  const reduceMotion = useReducedMotion()

  return (
    <div className="app-shell">
      <div className="desktop-chrome">{windowChrome}</div>
      <div className="app-body">
        {sidebar}
        <section className="desktop-main">
          <div className="desktop-main-stage">
            <AnimatePresence initial={false}>
              <motion.div
                animate={{ opacity: 1 }}
                className="desktop-route-stage"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                key={contentKey}
                transition={{
                  duration: reduceMotion ? 0 : 0.18,
                  ease: 'easeOut',
                }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  )
}
