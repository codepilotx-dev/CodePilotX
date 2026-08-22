import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopWorkspace } from '../shared/types.js'
import { ComposerCard } from '../src/features/session/composer/ComposerCard.js'
import type { ComposerSkillCommand } from '../src/features/session/composer/composerSlashCommands.js'
import { resolveActiveComposerSkillToken } from '../src/features/session/composer/useDesktopComposerController.js'

type ComposerCardProps = Parameters<typeof ComposerCard>[0]

const WORKSPACE: DesktopWorkspace = {
  name: 'Alpha 工作区',
  path: 'C:\\alpha',
  branchName: 'feature/working-surface',
}

const TASKBOARD_PLANNER: ComposerSkillCommand = {
  id: 'skill:taskboard-planner',
  trigger: 'taskboard-planner',
  title: 'taskboard-planner',
  description: '规划任务',
  source: 'skill',
  skill: {
    name: 'taskboard-planner',
    path: 'builtin://taskboard-planner/SKILL.md',
    scope: 'system',
  },
}

function composerCardProps(
  overrides: Partial<ComposerCardProps> = {},
): ComposerCardProps {
  return {
    input: '',
    canSubmit: true,
    sessionStatus: 'idle',
    permissionMode: 'default',
    thinkingMode: 'default',
    selectedProviderID: 'anthropic',
    selectedModelPreset: 'default',
    modelPresets: [],
    providerOptions: [],
    permissionOptions: [
      { value: 'default', label: '默认权限' },
      { value: 'auto-review', label: '自动审查' },
      { value: 'full-access', label: '完全访问' },
      { value: 'custom', label: '自定义' },
    ],
    thinkingOptions: [{ value: 'default', label: '默认' }],
    branchName: 'feature/working-surface',
    branches: ['feature/working-surface'],
    recentWorkspaces: [],
    workspace: null,
    onChooseWorkspace: () => {},
    onInputChange: () => {},
    onInterrupt: () => {},
    onProviderModelChange: () => {},
    onOpenWorkspace: () => {},
    onClearWorkspace: () => {},
    onBranchSelect: () => {},
    onCreateBranch: () => {},
    onPermissionChange: () => {},
    onSubmit: () => {},
    onThinkingChange: () => {},
    onOpenFiles: () => {},
    placement: 'new-session',
    ...overrides,
  }
}

describe('composer surface variant', () => {
  test('Working 任务规划使用实际生效的同名 Skill 路径', () => {
    const workspaceOverride: ComposerSkillCommand = {
      ...TASKBOARD_PLANNER,
      skill: {
        ...TASKBOARD_PLANNER.skill,
        path: 'C:/workspace/.codepilotx/skills/taskboard-planner/SKILL.md',
        scope: 'repo',
      },
    }

    expect(resolveActiveComposerSkillToken(
      'task-planning',
      null,
      [workspaceOverride],
    )?.skill.path).toBe(workspaceOverride.skill.path)
    expect(resolveActiveComposerSkillToken('task-planning', null, [])).toBeNull()
  })

  test('Coding、Working 与 Chat 输出各自的 data-surface 标记', () => {
    const coding = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'coding' })} />,
    )
    const working = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'working' })} />,
    )
    const chat = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'chat' })} />,
    )
    expect(coding).toContain('data-surface="coding"')
    expect(working).toContain('data-surface="working"')
    expect(working).toContain('data-placement="new-session"')
    expect(chat).toContain('data-surface="chat"')
  })

  test('Coding 未选 workspace 时保留进入项目工作入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'coding' })} />,
    )
    expect(html).toContain('进入项目工作')
    expect(html).not.toContain('选择文件夹')
  })

  test('Coding 选中 workspace 后保留本地、分支与项目行为', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({ surface: 'coding', workspace: WORKSPACE })}
      />,
    )
    expect(html).toContain('Alpha 工作区')
    expect(html).toContain('本地')
    expect(html).toContain('feature/working-surface')
    expect(html).toContain('选择分支')
  })

  test('Chat 不渲染项目工具条，但保留输入与提交结构', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({ surface: 'chat', workspace: WORKSPACE })}
      />,
    )
    expect(html).not.toContain('composer-utility-bar')
    expect(html).not.toContain('Alpha 工作区')
    expect(html).toContain('composer-input-surface')
    expect(html).toContain('aria-label="发送"')
  })

  test('未协商 dictation capability 时不渲染听写入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'chat' })} />,
    )
    // The SSR shell never negotiates dictation; the enabled path is covered by
    // the dedicated dictation suite instead of a disabled SSR stub.
    expect(html).not.toContain('composer-mic-button')
    expect(html).not.toContain('语音输入尚未可用')
  })

  test('模型配置异常时只保留一个安静的配置入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          modelConfigured: false,
          modelPresets: [],
          providerOptions: [],
        })}
      />,
    )

    expect(html).not.toContain('未配置模型')
    expect(html).toContain('>配置模型<')
    expect(html).not.toContain('class="rm-empty"')
  })

  test('Working 仅在任务规划 Skill 可用时显示插件入口', () => {
    const unavailable = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'working' })} />,
    )
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          surface: 'working',
          skillCommands: [TASKBOARD_PLANNER],
          taskPlanningAvailable: true,
        })}
      />,
    )
    expect(html).toContain('选择文件夹')
    expect(html).toContain('插件')
    expect(html).not.toContain('进入项目工作')
    expect(unavailable).not.toContain('插件')
  })

  test('Working 选中 workspace 后显示工作区名称并隐藏 Local 和分支', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({ surface: 'working', workspace: WORKSPACE })}
      />,
    )
    expect(html).toContain('Alpha 工作区')
    expect(html).not.toContain('本地')
    expect(html).not.toContain('feature/working-surface')
    expect(html).not.toContain('选择分支')
  })

  test('Working 选择规划任务后底栏保持通用插件入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          surface: 'working',
          workingPlugin: 'task-planning',
          skillCommands: [TASKBOARD_PLANNER],
          taskPlanningAvailable: true,
        })}
      />,
    )
    expect(html).toContain('选择工作插件')
    expect(html).not.toContain('取消工作插件')
  })
})
