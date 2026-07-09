import { expect, test, beforeEach, afterEach } from 'bun:test'

// ── Dynamic import — no module mocks needed, the service works with
//    its real module deps. Dynamic checks (starting the sidecar) are
//    tested separately in rustSidecarRuntime.test.ts. ─────────────────

const { DebugToolProbeService } = await import('./debugToolProbeService.js')

let service: InstanceType<typeof DebugToolProbeService>

beforeEach(() => {
  service = new DebugToolProbeService()
})

afterEach(() => {
  service.cleanup()
})

test('listBuiltinTools returns Rust sidecar check names', () => {
  const result = service.listBuiltinTools()
  expect(result.toolNames.length).toBeGreaterThan(0)
  expect(result.toolNames).toContain('binary-path')
  expect(result.toolNames).toContain('binary-exists')
  expect(result.toolNames).toContain('binary-source')
  expect(result.toolNames).toContain('config-directory')
  expect(result.toolNames).toContain('sqlite-home')
  expect(result.toolNames).toContain('protocol-capabilities')
  expect(result.toolNames).toContain('user-agent')
  expect(result.enabled.every(Boolean)).toBe(true)
})

test('listBuiltinTools marks dynamic checks as having probe input', () => {
  const result = service.listBuiltinTools()
  for (let i = 0; i < result.toolNames.length; i++) {
    const name = result.toolNames[i]!
    const hasProbe = result.hasProbeInput[i]!
    if (name === 'sqlite-home' || name === 'protocol-capabilities' || name === 'user-agent') {
      expect(hasProbe).toBe(true)
    } else {
      expect(hasProbe).toBe(false)
    }
  }
})

test('getRustSidecarInfo returns binary info without starting sidecar', () => {
  const info = service.getRustSidecarInfo()
  expect(info.binaryPath).toBeTruthy()
  expect(['env-override', 'workspace', 'bundled']).toContain(info.binarySource)
  expect(typeof info.binaryExists).toBe('boolean')
  expect(info.configDirectoryPath).toBeTruthy()
  expect(info.sqliteHome).toBeUndefined()
  expect(info.protocolCapabilities).toBeUndefined()
})

test('runProbe produces a report with correct structure', async () => {
  const report = await service.runProbe('safe')
  expect(report.runId).toMatch(/^rust-probe-/)
  expect(report.mode).toBe('safe')
  expect(report.startedAt).toBeTruthy()
  expect(report.finishedAt).toBeTruthy()
  expect(report.totalTools).toBeGreaterThan(0)
  expect(report.items.length).toBe(report.totalTools)
  expect(report.cancelled).toBeUndefined()

  // Static checks should always be present
  const pathItem = report.items.find(i => i.toolName === 'binary-path')
  expect(pathItem).toBeDefined()
  expect(pathItem!.status).toBe('passed')
  expect(pathItem!.reason).toBeTruthy()

  const existsItem = report.items.find(i => i.toolName === 'binary-exists')
  expect(existsItem).toBeDefined()
  // binary-exists depends on whether the resolved binary exists in the current env
  expect(['passed', 'failed']).toContain(existsItem!.status)

  const sourceItem = report.items.find(i => i.toolName === 'binary-source')
  expect(sourceItem).toBeDefined()
  expect(sourceItem!.status).toBe('passed')

  const configItem = report.items.find(i => i.toolName === 'config-directory')
  expect(configItem).toBeDefined()
  expect(configItem!.status).toBe('passed')
  expect(configItem!.reason).toBeTruthy()

  const protocolItem = report.items.find(i => i.toolName === 'protocol-capabilities')
  expect(protocolItem).toBeDefined()
  if (protocolItem!.status === 'passed') {
    expect(protocolItem!.reason).toContain('experimentalApi')
  }

  // All items should use the allowed status set (no unsupportedProbe)
  for (const item of report.items) {
    expect(['passed', 'failed', 'permissionDenied', 'skippedByEnvironment']).toContain(item.status)
  }

  // Counts should sum up
  expect(report.passed + report.failed + report.permissionDenied + report.skippedByEnvironment).toBe(report.totalTools)
})

test('cleanup does not throw', () => {
  // No temp files to clean up
  service.cleanup()
  // Second cleanup also safe
  service.cleanup()
})

test('startProbe and finishProbeRun manage lifecycle', () => {
  const { controller, runId } = service.startProbe('safe')
  expect(runId).toMatch(/^rust-probe-/)
  expect(controller.signal.aborted).toBe(false)

  // finishProbeRun doesn't abort
  service.finishProbeRun(runId)
  expect(controller.signal.aborted).toBe(false)
})

test('cancelRun aborts the abort controller', () => {
  const { controller, runId } = service.startProbe('safe')
  expect(controller.signal.aborted).toBe(false)
  service.cancelRun(runId)
  expect(controller.signal.aborted).toBe(true)
})

test('cancelling a non-existent run does not throw', () => {
  expect(() => service.cancelRun('nonexistent-id')).not.toThrow()
})

test('probe items have expected fields', async () => {
  const report = await service.runProbe('safe')
  for (const item of report.items) {
    expect(item.toolName).toBeTruthy()
    expect(item.status).toBeDefined()
    expect(['passed', 'failed', 'permissionDenied', 'skippedByEnvironment']).toContain(item.status)
    if (item.status === 'failed') {
      expect(item.error).toBeTruthy()
    }
  }
})
