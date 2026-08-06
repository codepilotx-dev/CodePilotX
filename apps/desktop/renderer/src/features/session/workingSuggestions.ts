import type { WorkingPlugin } from './composer/composerTypes.js'

export type WorkingSuggestionCategoryId = 'today' | 'complex' | 'multi-project'

export type WorkingSuggestionTask = {
  id: string
  label: string
  prompt: string
}

export type WorkingSuggestionCategory = {
  id: WorkingSuggestionCategoryId
  label: string
  tasks: readonly WorkingSuggestionTask[]
}

export type WorkingSuggestionState =
  | { kind: 'root' }
  | {
      kind: 'category'
      categoryId: WorkingSuggestionCategoryId
      generatedStarter: string
    }
  | { kind: 'hidden'; reason: 'prompt-filled' | 'custom-input' }

const taskPlanningPrompt = (taskLabel: string): string =>
  `请帮我${taskLabel}。先询问我要完成的任务、今天的可用时间、固定事项和每项预计耗时，再为我生成可以执行的时间安排。`

const complexTaskPlanningPrompt = (taskLabel: string): string =>
  `请帮我${taskLabel}。先确认工作目标、交付标准、已有资料、依赖和截止时间，再把它拆成可以逐步执行的工作安排。`

const multiProjectPlanningPrompt = (taskLabel: string): string =>
  `请帮我${taskLabel}。先确认各项目的目标、优先级、截止时间、预计耗时和固定约束，再协调冲突并生成整体工作安排。`

/** “重新规划剩余时间”使用专用提示词，不走分类模板。 */
const REMAINING_TIME_PROMPT =
  '请根据当前工作情况重新规划今天剩余的任务。保留已经完成和固定时间的事项，先向我确认缺失的预计耗时或时间约束，再调整剩余任务。'

export const WORKING_SUGGESTION_CATEGORIES = [
  {
    id: 'today',
    label: '规划今天的工作',
    tasks: [
      {
        id: 'today-all',
        label: '安排今天全部任务',
        prompt: taskPlanningPrompt('安排今天全部任务'),
      },
      {
        id: 'today-scheduled',
        label: '安排带固定时间的事项',
        prompt: taskPlanningPrompt('安排带固定时间的事项'),
      },
      {
        id: 'today-remaining',
        label: '重新规划剩余时间',
        prompt: REMAINING_TIME_PROMPT,
      },
    ],
  },
  {
    id: 'complex',
    label: '拆解复杂工作',
    tasks: [
      {
        id: 'complex-goals',
        label: '拆解目标和交付物',
        prompt: complexTaskPlanningPrompt('拆解目标和交付物'),
      },
      {
        id: 'complex-deps',
        label: '识别依赖和阻塞',
        prompt: complexTaskPlanningPrompt('识别依赖和阻塞'),
      },
      {
        id: 'complex-phases',
        label: '制定分阶段推进计划',
        prompt: complexTaskPlanningPrompt('制定分阶段推进计划'),
      },
    ],
  },
  {
    id: 'multi-project',
    label: '协调多个项目',
    tasks: [
      {
        id: 'multi-priorities',
        label: '平衡多个项目优先级',
        prompt: multiProjectPlanningPrompt('平衡多个项目优先级'),
      },
      {
        id: 'multi-time',
        label: '安排跨项目工作时间',
        prompt: multiProjectPlanningPrompt('安排跨项目工作时间'),
      },
      {
        id: 'multi-deadlines',
        label: '检查截止时间与冲突',
        prompt: multiProjectPlanningPrompt('检查截止时间与冲突'),
      },
    ],
  },
] as const satisfies readonly WorkingSuggestionCategory[]

export function findWorkingSuggestionCategory(
  categoryId: WorkingSuggestionCategoryId,
): WorkingSuggestionCategory {
  return WORKING_SUGGESTION_CATEGORIES.find(
    category => category.id === categoryId,
  )!
}

export function createWorkingSuggestionState(
  composerValue: string,
): WorkingSuggestionState {
  return composerValue.trim().length > 0
    ? { kind: 'hidden', reason: 'custom-input' }
    : { kind: 'root' }
}

/**
 * 建议只在 Composer 交互区域聚焦时显示；隐藏/失焦不重置分步状态。
 * 聚焦例外由调用方保证：焦点从编辑器移动到建议按钮时仍在区域内。
 */
export function shouldShowWorkingSuggestions(
  state: WorkingSuggestionState,
  hasInteractionFocus: boolean,
): boolean {
  return (
    hasInteractionFocus &&
    (state.kind === 'root' || state.kind === 'category')
  )
}

export function syncWorkingSuggestionState(
  state: WorkingSuggestionState,
  composerValue: string,
): WorkingSuggestionState {
  if (state.kind === 'category') return state
  return createWorkingSuggestionState(composerValue)
}

export function selectWorkingSuggestionCategory(
  categoryId: WorkingSuggestionCategoryId,
  starter: string,
): WorkingSuggestionState {
  return { kind: 'category', categoryId, generatedStarter: starter }
}

/**
 * 返回第一层：仅当输入仍等于系统自动填入的 starter 时才移除 starter；
 * 用户已编辑的内容不得清空或覆盖。
 */
export function returnToWorkingSuggestionRoot(
  state: WorkingSuggestionState,
  composerValue: string,
): { state: WorkingSuggestionState; composerValue: string } {
  if (state.kind !== 'category') return { state, composerValue }
  const nextValue =
    composerValue === state.generatedStarter ? '' : composerValue
  return { state: { kind: 'root' }, composerValue: nextValue }
}

/**
 * 点击第二层：自动选择「规划任务」插件，用完整中文提示词替换 Composer，
 * 不自动提交，隐藏建议列表。
 */
export function selectWorkingSuggestionTask(
  state: WorkingSuggestionState,
  taskId: string,
): { state: WorkingSuggestionState; prompt: string; plugin: WorkingPlugin } | null {
  if (state.kind !== 'category') return null
  const category = findWorkingSuggestionCategory(state.categoryId)
  const task = category.tasks.find(item => item.id === taskId)
  if (!task) return null
  return {
    state: { kind: 'hidden', reason: 'prompt-filled' },
    prompt: task.prompt,
    plugin: 'task-planning',
  }
}
