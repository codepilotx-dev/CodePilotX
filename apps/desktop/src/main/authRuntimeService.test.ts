import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { getRuntimeStatus } from './authRuntimeService.js'

const toolchainStatus = {
  enabled: false,
  root: null,
  managedRoot: '',
  packagedRoot: '',
  pathEntries: [],
  binaries: [],
}

test('runtime status reports explicit sidecar preference', async () => {
  const status = await getRuntimeStatus({
    agentExecutablePath: join(process.cwd(), 'package.json'),
    configDirectoryPath: process.cwd(),
    runtimePreference: 'sidecar',
    runtimeSelectionSource: 'env',
    toolchainStatus,
  })

  expect(status.runtimeKind).toBe('sidecar')
  expect(status.runtimePreference).toBe('sidecar')
})
