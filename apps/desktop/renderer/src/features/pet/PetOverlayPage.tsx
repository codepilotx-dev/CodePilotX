import React, { useEffect, useRef, useState } from 'react'
import { ExternalLink, Send, X } from 'lucide-react'
import { PetSprite } from './PetSprite.js'
import { PetQuickReply } from './PetQuickReply.js'
import { usePetOverlayController } from './usePetOverlayController.js'
import {
  resolvePetDragAnimation,
} from './petDirectionModel.js'
import type { PetAnimationName } from './petAnimationModel.js'
import { usePetLookFrame } from './usePetLookFrame.js'
import '../../styles/lazy/pet-overlay.scss'

export function PetOverlayPage(): React.ReactNode {
  const controller = usePetOverlayController()
  const [greeting, setGreeting] = useState(true)
  const [dragAnimation, setDragAnimation] =
    useState<PetAnimationName | null>(null)
  const [keyboardActive, setKeyboardActive] = useState(false)
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replySubmitting, setReplySubmitting] = useState(false)
  const dragScreenXRef = useRef<number | null>(null)
  const avatarRef = useRef<HTMLDivElement | null>(null)
  const lookFrame = usePetLookFrame(
    avatarRef,
    controller.pet?.spriteVersionNumber,
    dragAnimation === null,
  )

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

  const setKeyboardFocus = (focused: boolean): void => {
    setKeyboardActive(focused)
    setInteractive(focused)
    void window.codePilotXDesktop?.requestPetKeyboardFocus(focused)
  }

  const notification = controller.notification
  useEffect(() => {
    setReply('')
    setReplyError(null)
    setKeyboardActive(false)
    window.codePilotXDesktop?.setPetPointerPassthrough(true)
    void window.codePilotXDesktop?.requestPetKeyboardFocus(false)
  }, [notification?.id])

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

  return (
    <main className="pet-overlay-page">
      {notification || greeting ? (
        <section
          className="pet-overlay-pill pet-overlay-interactive"
          onBlurCapture={event => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
              return
            }
            setKeyboardFocus(false)
          }}
          onFocusCapture={() => setKeyboardFocus(true)}
          onPointerDown={() => setInteractive(true)}
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => {
            if (!keyboardActive) setInteractive(false)
          }}
        >
          <div className="pet-overlay-pill-header">
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
              <div className="pet-overlay-pill-actions">
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
              </div>
            ) : null}
          </div>
          {notification?.request ? (
            <div className="pet-overlay-pill-body">
              <PetQuickReply
                disabled={replySubmitting}
                request={notification.request}
                onRespond={(_request, decision) =>
                  controller.respond(notification, decision)}
              />
            </div>
          ) : null}
          {notification ? (
            <form
              className="pet-overlay-reply-form"
              onSubmit={event => {
                event.preventDefault()
                const text = reply.trim()
                if (!text || replySubmitting) return
                setReplySubmitting(true)
                setReplyError(null)
                void controller.reply(notification, text).then(() => {
                  setReply('')
                  setKeyboardFocus(false)
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur()
                  }
                }).catch(error => {
                  setReplyError(
                    error instanceof Error ? error.message : '回复失败，请重试。',
                  )
                }).finally(() => setReplySubmitting(false))
              }}
            >
              <input
                aria-label="快捷回复"
                disabled={replySubmitting}
                placeholder="回复这个任务…"
                value={reply}
                onChange={event => {
                  setReply(event.target.value)
                  setReplyError(null)
                }}
              />
              <button
                aria-label="发送回复"
                disabled={replySubmitting || !reply.trim()}
                type="submit"
              >
                <Send size={14} />
              </button>
              {replyError ? (
                <span aria-live="polite" className="pet-overlay-reply-error">
                  {replyError}
                </span>
              ) : null}
            </form>
          ) : null}
        </section>
      ) : null}

      <div
        ref={avatarRef}
        className="pet-overlay-avatar pet-overlay-interactive"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragScreenXRef.current = event.screenX
          setDragAnimation(controller.animation)
          window.codePilotXDesktop?.beginPetDrag()
        }}
        onPointerEnter={() => setInteractive(true)}
        onPointerLeave={() => setInteractive(false)}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            const previousScreenX = dragScreenXRef.current ?? event.screenX
            const deltaX = event.screenX - previousScreenX
            setDragAnimation(current =>
              resolvePetDragAnimation(
                current ?? controller.animation,
                deltaX,
              ),
            )
            if (Math.abs(deltaX) >= 4) dragScreenXRef.current = event.screenX
            window.codePilotXDesktop?.updatePetDrag()
          }
        }}
        onPointerUp={event => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          dragScreenXRef.current = null
          setDragAnimation(null)
          window.codePilotXDesktop?.endPetDrag()
        }}
        onPointerCancel={() => {
          dragScreenXRef.current = null
          setDragAnimation(null)
          window.codePilotXDesktop?.endPetDrag()
        }}
      >
        <PetSprite
          animation={dragAnimation ?? controller.animation}
          lookFrame={dragAnimation === null ? lookFrame : null}
          size={controller.size}
          spriteVersionNumber={controller.pet.spriteVersionNumber}
          spritesheetUrl={controller.pet.spritesheetUrl}
        />
      </div>
    </main>
  )
}
