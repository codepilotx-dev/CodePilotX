import { expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DebugToolProbeService } from './debugToolProbeService.js'

let service: DebugToolProbeService

beforeEach(() => {
  service = new DebugToolProbeService()
})

afterEach(() => {
  service.cleanup()
})

test('listBuiltinTools returns all tool names', () => {
  const result = service.listBuiltinTools()
  expect(result.toolNames.length).toBeGreaterThan(0)
  expect(result.toolNames).toContain('Read')
  expect(result.toolNames).toContain('Write')
  expect(result.toolNames).toContain('Bash')
  expect(result.toolNames).toContain('Glob')
  expect(result.toolNames).toContain('Grep')
  expect(result.toolNames).toContain('Edit')
  expect(result.toolNames).toContain('PowerShell')
  expect(result.toolNames).toContain('AgentTool')
  expect(result.toolNames).toContain('WebFetch')
})

test('listBuiltinTools marks stable tools as having probe input', () => {
  const result = service.listBuiltinTools()
  const stableSet = new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'PowerShell'])

  for (let i = 0; i < result.toolNames.length; i++) {
    const name = result.toolNames[i]!
    const hasProbe = result.hasProbeInput[i]!
    expect(hasProbe).toBe(stableSet.has(name))
  }
})

test('ensureWorkspace creates temp directory and log file', () => {
  service.ensureWorkspace()
  const wsPath = service.getWorkspacePath()
  expect(existsSync(wsPath)).toBe(true)
  const logPath = service.getLogPath()
  expect(existsSync(logPath)).toBe(true)
  expect(readFileSync(logPath, 'utf-8')).toBe('')
})

test('workspace paths are isolated per instance', () => {
  // Create second service a bit later to guarantee different timestamp
  const start = Date.now()
  while (Date.now() === start) {
    // Busy-wait until next ms tick
  }
  const service2 = new DebugToolProbeService()
  try {
    expect(service.getWorkspacePath()).not.toBe(service2.getWorkspacePath())
    expect(service.getLogPath()).not.toBe(service2.getLogPath())
  } finally {
    service2.cleanup()
  }
})

test('runProbe in safe mode produces a complete report', async () => {
  const report = await service.runProbe('safe')

  expect(report.runId).toMatch(/^probe-/)
  expect(report.mode).toBe('safe')
  expect(report.startedAt).toBeTruthy()
  expect(report.finishedAt).toBeTruthy()
  expect(report.totalTools).toBeGreaterThan(0)
  expect(report.items.length).toBe(report.totalTools)
  expect(report.cancelled).toBeUndefined()

  // Stable tools should pass
  const readItem = report.items.find(i => i.toolName === 'Read')
  expect(readItem).toBeDefined()
  expect(readItem!.status).toBe('passed')

  const writeItem = report.items.find(i => i.toolName === 'Write')
  expect(writeItem).toBeDefined()
  expect(writeItem!.status).toBe('passed')

  const bashItem = report.items.find(i => i.toolName === 'Bash')
  expect(bashItem).toBeDefined()
  expect(bashItem!.status).toBe('passed')

  // Unsupported tools should be marked accordingly
  const agentItem = report.items.find(i => i.toolName === 'AgentTool')
  expect(agentItem).toBeDefined()
  expect(agentItem!.status).toBe('unsupportedProbe')
  expect(agentItem!.reason).toBeTruthy()

  const webFetchItem = report.items.find(i => i.toolName === 'WebFetch')
  expect(webFetchItem).toBeDefined()
  expect(webFetchItem!.status).toBe('unsupportedProbe')
  expect(webFetchItem!.reason).toBeTruthy()

  // Counts should sum up
  expect(report.passed + report.failed + report.permissionDenied + report.unsupportedProbe + report.skippedByEnvironment).toBe(report.totalTools)
})

test('runProbe realAuto mode passes stable tools with auto-allowed permission', async () => {
  const report = await service.runProbe('realAuto')

  expect(report.mode).toBe('realAuto')

  const readItem = report.items.find(i => i.toolName === 'Read')
  expect(readItem).toBeDefined()
  expect(readItem!.status).toBe('passed')
  expect(readItem!.permissionDecision).toBe('auto-allowed')

  const editItem = report.items.find(i => i.toolName === 'Edit')
  expect(editItem).toBeDefined()
  expect(editItem!.status).toBe('passed')
  expect(editItem!.permissionDecision).toBe('auto-allowed')
})

test('probe items have expected fields', async () => {
  const report = await service.runProbe('safe')

  for (const item of report.items) {
    expect(item.toolName).toBeTruthy()
    expect(item.status).toBeDefined()
    expect(['passed', 'failed', 'permissionDenied', 'unsupportedProbe', 'skippedByEnvironment']).toContain(item.status)

    if (item.status === 'passed') {
      expect(typeof item.durationMs).toBe('number')
    }
    if (item.status === 'unsupportedProbe') {
      expect(item.reason).toBeTruthy()
    }
    if (item.status === 'failed') {
      expect(item.error).toBeTruthy()
    }
  }
})

test('cancel registers runId and cancels the abort controller', () => {
  const { controller, runId } = service.startProbe('safe')
  expect(runId).toMatch(/^probe-/)
  expect(controller.signal.aborted).toBe(false)
  service.cancelRun(runId)
  expect(controller.signal.aborted).toBe(true)
})

test('cancelling a non-existent run does not throw', () => {
  expect(() => service.cancelRun('nonexistent-id')).not.toThrow()
})

test('cleanup removes workspace directory', () => {
  service.ensureWorkspace()
  const wsPath = service.getWorkspacePath()
  expect(existsSync(wsPath)).toBe(true)

  service.cleanup()
  expect(existsSync(wsPath)).toBe(false)
})

test('cleanup is safe when called twice', () => {
  service.ensureWorkspace()
  service.cleanup()
  // Should not throw
  service.cleanup()
  const wsPath = service.getWorkspacePath()
  expect(existsSync(wsPath)).toBe(false)
})

test('runProbe logs to the log file', async () => {
  await service.runProbe('safe')
  const logPath = service.getLogPath()
  const logContent = readFileSync(logPath, 'utf-8')
  expect(logContent).toContain('Probe run started')
  expect(logContent).toContain('Probe run finished')
  expect(logContent).toContain('Read: passed')
})

test('realManual mode with denying permission handler marks as permissionDenied', async () => {
  service.setPermissionHandler({
    requestPermission: async () => 'deny',
  })

  const report = await service.runProbe('realManual')

  const readItem = report.items.find(i => i.toolName === 'Read')
  expect(readItem).toBeDefined()
  expect(readItem!.status).toBe('permissionDenied')
  expect(readItem!.permissionDecision).toBe('deny')

  expect(report.permissionDenied).toBeGreaterThan(0)
})

test('realManual mode with allowing permission handler runs probes', async () => {
  service.setPermissionHandler({
    requestPermission: async () => 'allow',
  })

  const report = await service.runProbe('realManual')

  const readItem = report.items.find(i => i.toolName === 'Read')
  expect(readItem).toBeDefined()
  expect(readItem!.status).toBe('passed')
  expect(readItem!.permissionDecision).toBe('allow')
})

test('Grep tool finds matching content', async () => {
  const report = await service.runProbe('safe')
  const grepItem = report.items.find(i => i.toolName === 'Grep')
  expect(grepItem).toBeDefined()
  expect(grepItem!.status).toBe('passed')
})

test('Glob tool finds files by pattern', async () => {
  const report = await service.runProbe('safe')
  const globItem = report.items.find(i => i.toolName === 'Glob')
  expect(globItem).toBeDefined()
  expect(globItem!.status).toBe('passed')
})

test('Bash tool executes commands', async () => {
  const report = await service.runProbe('safe')
  const bashItem = report.items.find(i => i.toolName === 'Bash')
  expect(bashItem).toBeDefined()
  expect(bashItem!.status).toBe('passed')
})
