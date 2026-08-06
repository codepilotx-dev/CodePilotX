import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopWorkspace } from '../shared/types.js'
import { ComposerCard } from '../src/features/session/composer/ComposerCard.js'

type ComposerCardProps = Parameters<typeof ComposerCard>[0]

const WORKSPACE: DesktopWorkspace = {
  name: 'Alpha 工作区',
  path: 'C:\\alpha',
  branchName: 'feature/working-surface',
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
  test('Working 输出 data-surface 标记，Coding/Chat 不输出', () => {
    const working = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'working' })} />,
    )
    const coding = renderToStaticMarkup(<ComposerCard {...composerCardProps()} />)
    expect(working).toContain('data-surface="working"')
    expect(working).toContain('data-placement="new-session"')
    expect(coding).not.toContain('data-surface')
  })

  test('Coding/Chat 未选 workspace 时保留进入项目工作入口', () => {
    const html = renderToStaticMarkup(<ComposerCard {...composerCardProps()} />)
    expect(html).toContain('进入项目工作')
    expect(html).not.toContain('选择文件夹')
  })

  test('Coding/Chat 选中 workspace 后保留本地、分支与项目行为', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ workspace: WORKSPACE })} />,
    )
    expect(html).toContain('Alpha 工作区')
    expect(html).toContain('本地')
    expect(html).toContain('feature/working-surface')
    expect(html).toContain('选择分支')
  })

  test('Working 新建页未选 workspace 时显示选择文件夹与插件入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'working' })} />,
    )
    expect(html).toContain('选择文件夹')
    expect(html).toContain('插件')
    expect(html).not.toContain('进入项目工作')
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

  test('Working 选择规划任务插件后芯片显示选中状态', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          surface: 'working',
          workingPlugin: 'task-planning',
        })}
      />,
    )
    expect(html).toContain('规划任务')
    expect(html).toContain('取消工作插件')
  })
})
