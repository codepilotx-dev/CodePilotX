/**
 * ThreadRuntimeAdapter —— 将 TUI 的 `ThreadRuntime` 适配为 core 的 `ThreadRuntimePort`。
 *
 * ThreadRuntime 是 TUI 层对 QueryEngine 的封装，提供线程/turn 生命周期管理。
 * 此适配器将其暴露为 core 层的 `ThreadRuntimePort` 接口，逐步削薄对
 * `QueryEngineConfig` 的直接暴露。
 *
 * v2 过渡期策略：
 *   - 保持 ThreadRuntime 不动（现有执行路径不变）
 *   - 新增此适配器供 SidecarDesktopAgentRuntime 等新消费者使用
 *   - 后续逐步将 ThreadRuntime 的内部逻辑迁移到 core port 实现中
 *
 * 参考：codex-main 的 MessageProcessor/app-server 分层模式
 */

import type { ThreadRuntimePort, ThreadStartSettings, ThreadStartResult, ThreadResumeResult, TurnInput, ForkOptions } from '@codepilotx/core/agent/ports.js'
import type { ThreadEvent, ThreadId } from '@codepilotx/core/agent/workflow.js'
import { ThreadRuntime } from './ThreadRuntime.js'
import type { ThreadRuntimeSettings, ThreadRuntimeForkOptions, ThreadRuntimeResumeState } from './ThreadRuntime.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

/**
 * 将 TUI 的 ThreadRuntimeSettings 风格转换为 core 的 ThreadStartSettings。
 * v2 过渡期：core 端口使用更抽象的设置，适配层负责映射。
 */
function toThreadRuntimeSettings(
  settings: ThreadStartSettings & { threadId?: ThreadId },
): ThreadRuntimeSettings {
  return {
    cwd: settings.cwd ?? '',
    tools: [],
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} }),
    getAppState: () => ({}) as never,
    setAppState: () => {},
    readFileCache: {},
    ...settings,
  } as unknown as ThreadRuntimeSettings
}

export class ThreadRuntimeAdapter implements ThreadRuntimePort {
  constructor(private readonly runtime: ThreadRuntime = new ThreadRuntime()) {}

  startThread(
    settings: ThreadStartSettings & { threadId?: ThreadId },
  ): ThreadStartResult {
    return this.runtime.startThread(toThreadRuntimeSettings(settings))
  }

  resumeThread(
    threadId: ThreadId,
    settings: ThreadStartSettings,
    state?: unknown,
  ): ThreadResumeResult {
    return this.runtime.resumeThread(
      threadId,
      toThreadRuntimeSettings(settings),
      state as ThreadRuntimeResumeState | undefined,
    )
  }

  forkThread(
    sourceThreadId: ThreadId,
    options?: ForkOptions,
  ): ThreadResumeResult {
    const forkOptions: ThreadRuntimeForkOptions | undefined = options
      ? {
          threadId: options.threadId,
          settings: options.settings
            ? toThreadRuntimeSettings({
                ...options.settings,
                threadId: options.threadId,
              })
            : undefined,
          metadata: options.metadata,
        }
      : undefined
    return this.runtime.forkThread(sourceThreadId, forkOptions)
  }

  async *submitTurn(
    input: TurnInput,
  ): AsyncGenerator<ThreadEvent, void, unknown> {
    for await (const event of this.runtime.sendTurn(input.threadId, input.input as string | ContentBlockParam[], {
      uuid: input.uuid,
      isMeta: input.isMeta,
      turnId: input.turnId,
    })) {
      yield event
    }
  }

  interruptTurn(threadId: ThreadId, turnId?: string): ThreadEvent {
    return this.runtime.interruptTurn(threadId, turnId)
  }

  rollbackTurn(threadId: ThreadId, turnId: string): ThreadEvent {
    return this.runtime.rollbackTurn(threadId, turnId)
  }
}
