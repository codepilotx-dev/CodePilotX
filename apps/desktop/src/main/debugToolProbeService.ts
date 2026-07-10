import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  DebugToolProbeItem,
  DebugToolProbeMode,
  DebugToolProbeReport,
  RustSidecarProbeInfo,
  RustSidecarBinarySource,
} from '../shared/types.js'
import {
  resolveRustAppServerExecutableInfo,
} from './rustSidecarRuntime.js'
import { desktopDebug } from './desktopDebug.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const RUST_PROBE_CHECK_NAMES = [
  'binary-path',
  'binary-exists',
  'binary-source',
  'config-directory',
  'sqlite-home',
  'protocol-capabilities',
  'user-agent',
] as const

export class DebugToolProbeService {
  private readonly probeChecks = [...RUST_PROBE_CHECK_NAMES]
  private runningRuns = new Map<string, AbortController>()

  /**
   * Get static Rust sidecar information (no process start needed).
   */
  getRustSidecarInfo(): RustSidecarProbeInfo {
    const executableInfo = resolveRustAppServerExecutableInfo()
    const configDirectoryPath =
      process.env.CODEPILOTX_CONFIG_DIR ??
      process.env.CLAUDE_CONFIG_DIR ??
      join(homedir(), '.codepilotx')

    return {
      binaryPath: executableInfo.path,
      binarySource: executableInfo.source as RustSidecarBinarySource,
      binaryExists: existsSync(executableInfo.path),
      configDirectoryPath,
    }
  }

  listBuiltinTools(): { toolNames: string[]; enabled: boolean[]; hasProbeInput: boolean[] } {
    const toolNames = [...this.probeChecks]
    const enabled = toolNames.map(() => true)
    // Dynamic checks (require starting the sidecar): sqlite-home, protocol-capabilities, user-agent
    const hasProbeInput = toolNames.map(name =>
      name === 'sqlite-home' || name === 'protocol-capabilities' || name === 'user-agent',
    )
    return { toolNames, enabled, hasProbeInput }
  }

  async runProbe(mode: DebugToolProbeMode, signal?: AbortSignal): Promise<DebugToolProbeReport> {
    const runId = `rust-probe-${Date.now()}`
    const startedAt = new Date().toISOString()
    const items: DebugToolProbeItem[] = []
    const staticInfo = this.getRustSidecarInfo()

    this.log(`Rust sidecar probe started: runId=${runId} mode=${mode}`)

    // ── Static checks (no sidecar start needed) ──────────────

    if (signal?.aborted) {
      return this.buildCancelledReport(runId, mode, startedAt, items)
    }

    // 1. binary-path
    items.push({
      toolName: 'binary-path',
      status: 'passed',
      reason: staticInfo.binaryPath,
    })
    this.log(`binary-path: ${staticInfo.binaryPath}`)

    // 2. binary-exists
    if (staticInfo.binaryExists) {
      items.push({
        toolName: 'binary-exists',
        status: 'passed',
        reason: 'Rust sidecar binary exists',
      })
      this.log('binary-exists: passed')
    } else {
      items.push({
        toolName: 'binary-exists',
        status: 'failed',
        reason: 'Rust sidecar binary not found',
        error: `Binary not found at: ${staticInfo.binaryPath}`,
      })
      this.log('binary-exists: failed - binary not found')
    }

    // 3. binary-source
    items.push({
      toolName: 'binary-source',
      status: 'passed',
      reason: `Source: ${staticInfo.binarySource}`,
    })
    this.log(`binary-source: ${staticInfo.binarySource}`)

    // 4. config-directory
    items.push({
      toolName: 'config-directory',
      status: 'passed',
      reason: staticInfo.configDirectoryPath,
    })
    this.log(`config-directory: ${staticInfo.configDirectoryPath}`)

    // ── Dynamic checks (require starting the sidecar) ──────────

    if (staticInfo.binaryExists && !signal?.aborted) {
      // Attempt to start the Rust sidecar to get protocol info
      try {
        const dynamicInfo = await this.tryStartRustSidecar(signal)
        if (dynamicInfo.sqliteHome) {
          items.push({
            toolName: 'sqlite-home',
            status: 'passed',
            reason: dynamicInfo.sqliteHome,
          })
          this.log(`sqlite-home: ${dynamicInfo.sqliteHome}`)
        } else {
          items.push({
            toolName: 'sqlite-home',
            status: 'failed',
            reason: 'No sqlite home reported',
          })
          this.log('sqlite-home: not reported')
        }

        if (dynamicInfo.protocolCapabilities && dynamicInfo.protocolCapabilities.length > 0) {
          items.push({
            toolName: 'protocol-capabilities',
            status: 'passed',
            reason: dynamicInfo.protocolCapabilities.join(', '),
          })
          this.log(`protocol-capabilities: ${dynamicInfo.protocolCapabilities.join(', ')}`)
        } else {
          items.push({
            toolName: 'protocol-capabilities',
            status: 'passed',
            reason: 'Standard protocol (no experimental features)',
          })
          this.log('protocol-capabilities: standard')
        }

        if (dynamicInfo.userAgent) {
          items.push({
            toolName: 'user-agent',
            status: 'passed',
            reason: dynamicInfo.userAgent,
          })
          this.log(`user-agent: ${dynamicInfo.userAgent}`)
        } else {
          items.push({
            toolName: 'user-agent',
            status: 'failed',
            reason: 'No user agent reported',
          })
          this.log('user-agent: not reported')
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        // Mark dynamic checks as failed
        for (const name of ['sqlite-home', 'protocol-capabilities', 'user-agent']) {
          if (!items.find(i => i.toolName === name)) {
            items.push({
              toolName: name,
              status: 'failed',
              reason: 'Sidecar start failed',
              error: errorMsg,
            })
          }
        }
        this.log(`dynamic checks failed: ${errorMsg}`)
      }
    } else if (!signal?.aborted) {
      // Binary doesn't exist — skip dynamic checks
      for (const name of ['sqlite-home', 'protocol-capabilities', 'user-agent']) {
        items.push({
          toolName: name,
          status: 'skippedByEnvironment',
          reason: 'Binary not available',
        })
      }
      this.log('dynamic checks skipped: binary not available')
    }

    const finishedAt = new Date().toISOString()
    this.log(`Rust sidecar probe finished: ${runId}`)

    return {
      runId,
      mode,
      startedAt,
      finishedAt,
      totalTools: items.length,
      passed: items.filter(i => i.status === 'passed').length,
      failed: items.filter(i => i.status === 'failed').length,
      permissionDenied: items.filter(i => i.status === 'permissionDenied').length,
      skippedByEnvironment: items.filter(i => i.status === 'skippedByEnvironment').length,
      items,
    }
  }

  cancelRun(runId: string): void {
    const controller = this.runningRuns.get(runId)
    if (controller) {
      controller.abort()
      this.runningRuns.delete(runId)
      this.log(`Probe run cancelled: ${runId}`)
    }
  }

  startProbe(_mode: DebugToolProbeMode): { controller: AbortController; runId: string } {
    const runId = `rust-probe-${Date.now()}`
    const controller = new AbortController()
    this.runningRuns.set(runId, controller)
    return { controller, runId }
  }

  finishProbeRun(runId: string): void {
    this.runningRuns.delete(runId)
  }

  cleanup(): void {
    // No temp files to clean up (no workspace needed)
  }

  // ── Private ──────────────────────────────────────────────────

  private async tryStartRustSidecar(
    signal?: AbortSignal,
  ): Promise<{
    sqliteHome?: string
    protocolCapabilities?: string[]
    userAgent?: string
  }> {
    // Dynamically import the runtime to avoid circular deps at load time
    const { RustSidecarDesktopAgentRuntime } = await import('./rustSidecarRuntime.js')
    const { randomUUID } = await import('node:crypto')

    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: `probe-${randomUUID()}`,
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    try {
      // Probe the sidecar with a 10-second timeout
      const probeInfo = await Promise.race([
        runtime.probeServer(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Sidecar probe timed out after 10s')), 10_000)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('Sidecar probe cancelled'))
          }, { once: true })
        }),
      ])

      // Collect protocol capabilities from the init result
      const capabilities: string[] = []
      capabilities.push(`platform: ${probeInfo.platformFamily} / ${probeInfo.platformOs}`)
      capabilities.push('experimentalApi: disabled')
      capabilities.push('requestAttestation: disabled')

      // Dispose cleanly
      await runtime.dispose()

      return {
        sqliteHome: probeInfo.codepilotxHome ?? probeInfo.codexHome,
        protocolCapabilities: capabilities,
        userAgent: probeInfo.userAgent,
      }
    } catch (err) {
      await runtime.dispose().catch(() => {})
      throw err
    }
  }

  private log(message: string): void {
    desktopDebug('rust_probe', { message })
  }

  private buildCancelledReport(
    runId: string,
    mode: DebugToolProbeMode,
    startedAt: string,
    items: DebugToolProbeItem[],
  ): DebugToolProbeReport {
    return {
      runId,
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      cancelled: true,
      totalTools: items.length,
      passed: 0,
      failed: 0,
      permissionDenied: 0,
      skippedByEnvironment: 0,
      items,
    }
  }
}
