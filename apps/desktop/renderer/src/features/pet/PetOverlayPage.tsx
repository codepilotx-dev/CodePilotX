import React, { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { PetSprite } from './PetSprite.js'
import { usePetOverlayController } from './usePetOverlayController.js'
import '../../styles/lazy/pet-overlay.scss'

export function PetOverlayPage(): React.ReactNode {
  const controller = usePetOverlayController()
  const [greeting, setGreeting] = useState(true)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.windowKind = 'pet-overlay'
    root.classList.add('pet-overlay-surface')
    document.body.classList.add('pet-overlay-surface')
    const timer = window.setTimeout(() => setGreeting(false), 15_000)
    return () => {
      delete root.dataset.windowKind
      root.classList.remove('pet-overlay-surface')
      document.body.classList.remove('pet-overlay-surface')
      window.clearTimeout(timer)
    }
  }, [])

  const setInteractive = (interactive: boolean): void => {
    window.codePilotXDesktop?.setPetPointerPassthrough(!interactive)
  }

  if (!controller.pet) {
    return (
      <main className="pet-overlay-page">
        <div
          className="pet-overlay-empty pet-overlay-interactive"
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => setInteractive(false)}
        >
          请先在“设置 → 宠物”安装一个宠物包。
        </div>
      </main>
    )
  }

  const notification = controller.notification
  return (
    <main className="pet-overlay-page">
      {notification || greeting ? (
        <section
          className="pet-overlay-pill pet-overlay-interactive"
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => setInteractive(false)}
        >
          <div className="pet-overlay-pill-copy">
            <strong>
              {notification?.title ?? `你好，我是 ${controller.pet.displayName}`}
            </strong>
            <span>
              {notification?.detail
                ?? '我会在任务需要你时提醒你。'}
            </span>
          </div>
          {notification ? (
            <>
              <button
                aria-label="打开任务"
                onClick={() => void controller.openThread(notification.threadId)}
                type="button"
              >
                <ExternalLink size={15} />
              </button>
              <button
                aria-label="关闭提醒"
                onClick={() => controller.dismiss(notification.id)}
                type="button"
              >
                <X size={15} />
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      <div
        className="pet-overlay-avatar pet-overlay-interactive"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          window.codePilotXDesktop?.beginPetDrag()
        }}
        onPointerEnter={() => setInteractive(true)}
        onPointerLeave={() => setInteractive(false)}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            window.codePilotXDesktop?.updatePetDrag()
          }
        }}
        onPointerUp={event => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          window.codePilotXDesktop?.endPetDrag()
        }}
      >
        <PetSprite
          animation={controller.animation}
          size={controller.size}
          spriteVersionNumber={controller.pet.spriteVersionNumber}
          spritesheetUrl={controller.pet.spritesheetUrl}
        />
      </div>
    </main>
  )
}
