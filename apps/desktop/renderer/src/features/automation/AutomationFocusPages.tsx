import { useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'

type Page = 'agenda' | 'detail'

export function AutomationFocusPages({ page, agenda, children, onSettled }: {
  page: Page
  agenda: React.ReactNode
  children: React.ReactNode
  onSettled: (page: Page) => void
}): React.ReactNode {
  const [settled, setSettled] = useState(page)
  const reducedMotion = usePrefersReducedMotion()
  const incomingRef = useRef<HTMLDivElement>(null)
  const callback = useRef(onSettled)
  callback.current = onSettled
  const moving = settled !== page

  useLayoutEffect(() => {
    if (!moving || reducedMotion || !incomingRef.current ||
      parseFloat(getComputedStyle(incomingRef.current).animationDuration) === 0) {
      setSettled(page)
      callback.current(page)
      return
    }
    const incoming = incomingRef.current
    const cancel = () => setSettled(page)
    incoming.addEventListener('animationcancel', cancel)
    return () => incoming.removeEventListener('animationcancel', cancel)
  }, [page, moving, reducedMotion])

  return <div className="automation-focus-pages" data-direction={moving ? page === 'detail' ? 'forward' : 'back' : undefined}>
    {(['agenda', 'detail'] as const).map(kind => <div
      key={kind}
      ref={kind === page ? incomingRef : undefined}
      className="automation-focus-page"
      data-page={kind}
      data-entering={moving && kind === page || undefined}
      data-leaving={moving && kind !== page || undefined}
      hidden={!moving && kind !== page}
      inert={kind !== page || moving}
      aria-hidden={kind !== page || moving || undefined}
      onAnimationEnd={event => {
        if (event.target === event.currentTarget && kind === page) setSettled(page)
      }}
    >{kind === 'agenda' ? agenda : children}</div>)}
  </div>
}
