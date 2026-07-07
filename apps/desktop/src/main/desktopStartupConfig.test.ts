import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('desktop startup enables TUI config before listing slash commands', async () => {
  const source = await readFile(
    join(process.cwd(), 'apps/desktop/src/main/index.ts'),
    'utf8',
  )

  expect(source).toContain(
    "import { enableConfigs } from '@codepilotx/tui/utils/config.js'",
  )
  expect(source).not.toContain(
    "import { enableConfigs } from '@codepilotx/core/utils/config.js'",
  )
})
