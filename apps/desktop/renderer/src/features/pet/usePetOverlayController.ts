import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PetDescriptor } from '@codepilotx/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import type { DesktopSessionSnapshot } from '../../../shared/types.js'
import {
  projectPetNotifications,
  type PetNotification,
} from './petNotificationProjector.js'
import type { PetAnimationName } from './petAnimationModel.js'

export function usePetOverlayController(): {
  animation: PetAnimationName
  dismiss: (id: string) => void
  notification: PetNotification | null
  openThread: (threadId: string) => Promise<void>
  pet: PetDescriptor | null
  size: number
} {
  const { draft } = useDesktopSettings()
  const preferences = draft.values.pet
  const [pets, setPets] = useState<readonly PetDescriptor[]>([])
  const [sessions, setSessions] = useState<readonly DesktopSessionSnapshot[]>([])
  const [notifications, setNotifications] = useState<PetNotification[]>([])
  const dismissed = useRef(new Set<string>())
  const previousSessions = useRef<readonly DesktopSessionSnapshot[]>([])

  const updateSessions = useCallback(
    (next: readonly DesktopSessionSnapshot[]) => {
      const now = Date.now()
      setNotifications(
        projectPetNotifications({
          previous: previousSessions.current,
          current: next,
          now,
          dismissedIds: dismissed.current,
          preferences,
        }),
      )
      previousSessions.current = next
      setSessions(next)
    },
    [preferences],
  )

  useEffect(() => {
    void Promise.all([
      desktopClient.listPets(),
      desktopClient.listSessions(),
    ]).then(([catalog, snapshots]) => {
      setPets(catalog)
      previousSessions.current = snapshots
      setSessions(snapshots)
      setNotifications(
        projectPetNotifications({
          previous: [],
          current: snapshots,
          now: Date.now(),
          dismissedIds: dismissed.current,
          preferences,
        }),
      )
    })
    return desktopClient.onSessionStoreChange(change => {
      updateSessions(change.sessions)
    })
  }, [preferences, updateSessions])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setNotifications(current =>
        current.filter(item => item.expiresAt === null || item.expiresAt > now),
      )
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const pet = useMemo(
    () =>
      pets.find(item => item.id === preferences.selectedPetId)
      ?? pets[0]
      ?? null,
    [pets, preferences.selectedPetId],
  )
  const notification = notifications[0] ?? null
  const animation: PetAnimationName = notification
    ? notification.kind === 'completed'
      ? 'jumping'
      : notification.kind === 'failed'
        ? 'failed'
        : 'waiting'
    : sessions.some(snapshot => snapshot.item.status === 'running')
      ? 'running'
      : 'idle'

  return {
    animation,
    dismiss: id => {
      dismissed.current.add(id)
      setNotifications(current => current.filter(item => item.id !== id))
    },
    notification,
    openThread: async threadId => {
      await window.codePilotXDesktop?.openPetSession(threadId)
    },
    pet,
    size: preferences.size,
  }
}
