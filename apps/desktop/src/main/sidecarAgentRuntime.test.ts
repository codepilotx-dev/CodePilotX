import { expect, mock, test } from 'bun:test'
import { SidecarDesktopAgentRuntime } from './sidecarAgentRuntime.js'

test('default sidecar runtime awaits and propagates manager stop failure', async () => {
  const runtime = new SidecarDesktopAgentRuntime({
    sessionId: 'sidecar-dispose',
    workspacePath: process.cwd(),
    emit: () => {},
    requestPermission: async () => ({ behavior: 'deny' }),
  })
  const stop = mock(async () => {
    throw new Error('kill denied')
  })
  ;(runtime as unknown as { sidecarManager: { stop: typeof stop } }).sidecarManager = {
    stop,
  }

  await expect(runtime.dispose()).rejects.toThrow('kill denied')
  expect(stop).toHaveBeenCalledTimes(1)
})
