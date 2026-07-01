import { expect, mock, test } from 'bun:test'
import { activateSession, type SessionActionContext } from './sessionActions.js'

test('activateSession does nothing when the active session id is unchanged', () => {
  const setSessionId = mock()
  const setSessionStatus = mock()
  const setSessions = mock()
  const context = {
    activeSessionIdRef: { current: null },
    sessionViewsRef: { current: {} },
    sessionWorkspacesRef: { current: {} },
    onErrorRef: { current: mock() },
    viewSetters: {
      setEvents: mock(),
      setWorkflowEvents: mock(),
      setMessages: mock(),
      setToolLog: mock(),
      setPendingPermissions: mock(),
      setContextUsage: mock(),
    },
    setSessions,
    setSessionId,
    setSessionStatus,
  } as unknown as SessionActionContext

  activateSession(context, null)

  expect(setSessionId).not.toHaveBeenCalled()
  expect(setSessionStatus).not.toHaveBeenCalled()
  expect(setSessions).not.toHaveBeenCalled()
})
