import { describe, expect, test } from 'bun:test'
import { defaultDesktopStoredSettings } from '../shared/settingsSchema.js'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

describe('desktop external open client', () => {
  test('maps the Electron targetId wire shape and marks the persisted preference', async () => {
    const opened: Array<{ path: string; targetId: string }> = []
    let settings = {
      ...defaultDesktopStoredSettings(),
      defaultOpenTargetId: 'cursor',
    }
    const client = createDesktopClient({
      window: {
        codePilotXDesktop: {
          pickWorkspaceDirectory: async () => null,
          getDesktopSettings: async () => settings,
          saveDesktopSettings: async value => {
            settings = value as typeof settings
            return settings
          },
          listExternalOpenTargets: async () => [
            {
              targetId: 'default-app',
              label: '系统默认应用',
              kind: 'default-app',
            },
            {
              targetId: 'cursor',
              label: 'Cursor',
              kind: 'editor',
              iconDataUrl: 'data:image/png;base64,cursor',
            },
          ],
          openPathWithTarget: async (path, targetId) => {
            opened.push({ path, targetId })
          },
          revealPathInFolder: async () => undefined,
        },
      },
    })

    await expect(client.listExternalOpenTargets('C:\\workspace')).resolves.toEqual([
      {
        id: 'default-app',
        label: '系统默认应用',
        kind: 'default-app',
        preferred: false,
      },
      {
        id: 'cursor',
        label: 'Cursor',
        kind: 'editor',
        iconDataUrl: 'data:image/png;base64,cursor',
        preferred: true,
      },
    ])

    await client.openPathWithDefaultTarget('C:\\workspace')
    expect(opened).toEqual([{ path: 'C:\\workspace', targetId: 'cursor' }])

    await client.openPathWithTarget('C:\\workspace\\README.md', 'default-app')
    expect(settings.defaultOpenTargetId).toBe('default-app')
    expect(opened.at(-1)).toEqual({
      path: 'C:\\workspace\\README.md',
      targetId: 'default-app',
    })
  })
})
