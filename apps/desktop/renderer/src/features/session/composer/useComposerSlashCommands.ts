import { useCallback, useMemo, useRef, useState } from 'react'
import type { ComposerCapabilities } from './composerTypes.js'
import type {
  ComposerSlashCommand,
  ComposerSlashCommandId,
} from './composerSlashCommands.js'

type UseComposerSlashCommandsOptions = {
  capabilities: ComposerCapabilities
  planModeActive: boolean
  goalModeEnabled: boolean
  hasConversationMessages: boolean
  hasThread: boolean
  canReview: boolean
  subagentMode: boolean
  sessionBusy: boolean
  onOpenModel: () => void
  onOpenReasoning: () => void
  onOpenStatus: () => void
  onOpenMcp?: () => void
  onPlanModeChange?: (active: boolean) => void
  onGoalModeChange?: (active: boolean) => void
  onOpenReview: () => void
  onCompact?: () => Promise<void>
  onError?: (message: string) => void
}

export function useComposerSlashCommands({
  capabilities,
  planModeActive,
  goalModeEnabled,
  hasConversationMessages,
  hasThread,
  canReview,
  subagentMode,
  sessionBusy,
  onOpenModel,
  onOpenReasoning,
  onOpenStatus,
  onOpenMcp,
  onPlanModeChange,
  onGoalModeChange,
  onOpenReview,
  onCompact,
  onError,
}: UseComposerSlashCommandsOptions): {
  commands: ComposerSlashCommand[]
  executingCommandId: ComposerSlashCommandId | null
  executeCommand: (command: ComposerSlashCommand) => Promise<void>
} {
  const executingRef = useRef<ComposerSlashCommandId | null>(null)
  const [executingCommandId, setExecutingCommandId] =
    useState<ComposerSlashCommandId | null>(null)

  const compactEnabled =
    hasThread &&
    hasConversationMessages &&
    !subagentMode &&
    !sessionBusy &&
    Boolean(onCompact)

  const commands = useMemo<ComposerSlashCommand[]>(
    () => [
      command('model', '模型', '选择当前任务使用的模型', true, true, onOpenModel),
      command(
        'reasoning',
        '推理',
        '选择当前任务的推理强度',
        true,
        true,
        onOpenReasoning,
      ),
      command(
        'plan',
        '计划模式',
        planModeActive ? '关闭计划模式' : '开启计划模式',
        !subagentMode,
        Boolean(onPlanModeChange),
        () => onPlanModeChange?.(!planModeActive),
      ),
      command(
        'goal',
        '目标',
        goalModeEnabled ? '目标模式已开启' : '设置持续执行的目标',
        capabilities.goals && !subagentMode,
        Boolean(onGoalModeChange),
        () => {
          if (!goalModeEnabled) onGoalModeChange?.(true)
        },
      ),
      command(
        'review',
        '代码审查',
        '审查未提交更改或与基础分支比较',
        capabilities.review && !subagentMode,
        hasThread && canReview,
        onOpenReview,
        '请先创建任务后再开始代码审查',
      ),
      command(
        'compact',
        '压缩上下文',
        '压缩当前任务的上下文',
        !subagentMode,
        compactEnabled,
        async () => onCompact?.(),
        hasThread
          ? hasConversationMessages
            ? sessionBusy
              ? '任务运行期间不能压缩上下文'
              : '当前无法压缩上下文'
            : '当前任务还没有可压缩的消息'
          : '请先创建任务后再压缩上下文',
      ),
      command(
        'mcp',
        'MCP',
        '查看 MCP 服务器状态',
        Boolean(onOpenMcp),
        Boolean(onOpenMcp),
        () => onOpenMcp?.(),
        '当前界面无法打开 MCP 设置',
      ),
      command(
        'status',
        '状态',
        '显示任务 ID、上下文用量和速率限制',
        capabilities.status,
        true,
        onOpenStatus,
      ),
    ],
    [
      capabilities.goals,
      capabilities.review,
      capabilities.status,
      canReview,
      compactEnabled,
      goalModeEnabled,
      hasConversationMessages,
      hasThread,
      onCompact,
      onGoalModeChange,
      onOpenMcp,
      onOpenModel,
      onOpenReasoning,
      onOpenReview,
      onOpenStatus,
      onPlanModeChange,
      planModeActive,
      sessionBusy,
      subagentMode,
    ],
  )

  const executeCommand = useCallback(
    async (selected: ComposerSlashCommand) => {
      if (!selected.availability.enabled || executingRef.current) return
      executingRef.current = selected.id
      setExecutingCommandId(selected.id)
      try {
        await selected.execute()
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error))
      } finally {
        executingRef.current = null
        setExecutingCommandId(null)
      }
    },
    [onError],
  )

  return { commands, executingCommandId, executeCommand }
}

function command(
  id: ComposerSlashCommandId,
  title: string,
  description: string,
  visible: boolean,
  enabled: boolean,
  execute: () => void | Promise<void>,
  disabledReason?: string,
): ComposerSlashCommand {
  return {
    id,
    trigger: id,
    title,
    description,
    source: 'builtin',
    availability: {
      visible,
      enabled,
      ...(disabledReason ? { disabledReason } : {}),
    },
    execute,
  }
}
