import type { WorktreeEnvironmentLifecycle } from "../worktree/types"
import type { LocalEnvironmentService } from "./LocalEnvironmentService"

/** Bridges managed-worktree lifecycle operations to the trusted local environment runner. */
export class LocalEnvironmentWorktreeLifecycle implements WorktreeEnvironmentLifecycle {
  constructor(private readonly environments: LocalEnvironmentService) {}

  async setup(input: Parameters<WorktreeEnvironmentLifecycle["setup"]>[0]) {
    const operation = await this.environments.runLifecycle({
      cwd: input.workspacePath,
      bindingId: input.worktreeId,
      kind: "setup",
      operationId: input.operationId,
    })
    this.forwardOutput(input.operationId, input.onOutput)
    const environment = await this.environments.hostEnvironmentForBinding(input.worktreeId)
    return {
      status: operation?.status === "failed" ? "failed" as const : "succeeded" as const,
      environmentRevision: environment.revision,
    }
  }

  async cleanup(input: Parameters<WorktreeEnvironmentLifecycle["cleanup"]>[0]) {
    const operation = await this.environments.runLifecycle({
      cwd: input.workspacePath,
      bindingId: input.worktreeId,
      kind: "cleanup",
      operationId: input.operationId,
    })
    this.forwardOutput(input.operationId, input.onOutput)
    if (operation?.status === "failed") throw new Error("WORKTREE_CLEANUP_FAILED")
    return {}
  }

  private forwardOutput(operationId: string, onOutput: (chunk: string) => void) {
    const page = this.environments.operationOutput(operationId)
    for (const chunk of page?.chunks ?? []) onOutput(chunk.data)
  }
}
