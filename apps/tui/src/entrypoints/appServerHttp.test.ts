import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('HTTP app-server entrypoint starts listening before printing ready payload', async () => {
  const text = await readFile(
    join(process.cwd(), 'apps/tui/src/entrypoints/appServerHttp.ts'),
    'utf8',
  )

  const startIndex = text.indexOf('await httpServer.start()')
  const readyIndex = text.indexOf("type: 'app_server_ready'")

  expect(startIndex).toBeGreaterThan(0)
  expect(readyIndex).toBeGreaterThan(startIndex)
})
