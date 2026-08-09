export type StartupRecoveryStages = {
  recoverInterruptedRuns: () => void
  recoverResumeLeases: () => void
  restoreQuestionTimers: () => void
  recoverSubagents: () => void | Promise<void>
  recoverHandoffs: () => void | Promise<void>
  recoverForks: () => void | Promise<void>
  startQueues: () => void
}

/**
 * Explicit readiness gate. A rejected stage is fatal and must prevent the
 * HTTP server (and therefore /api/ready) from being created.
 */
export class StartupRecoveryCoordinator {
  constructor(private readonly stages: StartupRecoveryStages) {}

  async run() {
    this.stages.recoverInterruptedRuns()
    this.stages.recoverResumeLeases()
    this.stages.restoreQuestionTimers()
    await this.stages.recoverSubagents()
    await this.stages.recoverHandoffs()
    await this.stages.recoverForks()
    this.stages.startQueues()
  }
}
