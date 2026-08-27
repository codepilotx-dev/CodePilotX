import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopWorkspace } from '../shared/types.js'
import { ComposerCard } from '../src/features/session/composer/ComposerCard.js'
import {
  resolveMagneticSliderPosition,
  resolveThinkingLabel,
  resolveThinkingOptions,
} from '../src/features/session/composer/ThinkingLevelPopover.js'
import { resolveComposerCanSubmit } from '../src/features/session/composer/useDesktopComposerController.js'

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
    showThinkingOptions: false,
    deepSeekThinkingControls: false,
    showContextUsage: false,
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

  test('Composer 独立投影首页外壳、实际布局与圆角角色', () => {
    const defaults = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ placement: 'thread' })} />,
    )
    const home = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          layout: 'multiline',
          radiusVariant: 'default',
          utilityBarVariant: 'home',
        })}
      />,
    )
    const singleLine = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          layout: 'single-line',
          radiusVariant: 'single-line',
        })}
      />,
    )
    const compact = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({ radiusVariant: 'compact' })}
      />,
    )

    expect(defaults).toContain('data-composer-layout="multiline"')
    expect(defaults).toContain('data-composer-radius-variant="default"')
    expect(defaults).toContain(
      'data-composer-utility-bar-variant="default"',
    )
    expect(home).toContain('data-composer-layout="multiline"')
    expect(home).toContain('data-composer-radius-variant="default"')
    expect(home).toContain('data-composer-utility-bar-variant="home"')
    expect(singleLine).toContain('data-composer-layout="single-line"')
    expect(singleLine).toContain('data-composer-radius-variant="single-line"')
    expect(compact).toContain('data-composer-radius-variant="compact"')
  })

  test('Coding 未选 workspace 时保留进入项目工作入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'coding' })} />,
    )
    expect(html).toContain('进入项目工作')
    expect(html).not.toContain('选择文件夹')
  })

  test('Coding 选中 workspace 后显示会话组、分支与项目行为', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({ surface: 'coding', workspace: WORKSPACE })}
      />,
    )
    expect(html).toContain('Alpha 工作区')
    expect(html).toContain('会话组')
    expect(html).toContain('feature/working-surface')
    expect(html).toContain('选择分支')
  })

  test('Chat 不渲染项目选择，但保留会话组、输入与提交结构', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({ surface: 'chat', workspace: WORKSPACE })}
      />,
    )
    expect(html).toContain('class="composer-bottom composer-utility-bar')
    expect(html).not.toContain('Alpha 工作区')
    expect(html).toContain('会话组')
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

  test('模型与推理强度渲染为统一入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          modelConfigured: true,
          modelPresets: [
            { id: 'claude-sonnet', label: 'Claude Sonnet', value: 'claude-sonnet' },
          ],
          selectedModelPreset: 'claude-sonnet',
          showThinkingOptions: true,
          thinkingMode: 'adaptive',
          thinkingOptions: [
            { value: 'disabled', label: '低' },
            { value: 'default', label: '中' },
            { value: 'adaptive', label: '高' },
            { value: 'enabled', label: '超高' },
          ],
        })}
      />,
    )

    expect(html).toContain('composer-model-chip')
    expect(html).toContain('>Claude Sonnet</span>')
    expect(html).toContain('composer-model-chip-thinking')
    expect(html).toContain('>高</span>')
    expect(html).toContain('aria-label="模型与推理设置：Claude Sonnet，高"')
    expect(html).not.toContain('composer-thinking-chip')
  })

  test('不支持思考等级时隐藏等级按钮并保留现有等级映射', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ showThinkingOptions: false })} />,
    )
    const regularOptions = composerCardProps().thinkingOptions
    const deepSeekOptions = resolveThinkingOptions(true, regularOptions)

    expect(html).not.toContain('composer-thinking-chip')
    expect(html).not.toContain('composer-model-chip-thinking')
    expect(resolveThinkingLabel(regularOptions, 'default')).toBe('默认')
    expect(deepSeekOptions.map(option => option.label)).toEqual(['关闭', '高', '超高'])
    expect(resolveThinkingLabel(deepSeekOptions, 'enabled')).toBe('超高')
  })

  test('思考等级滑块仅在档位附近施加连续磁吸', () => {
    expect(resolveMagneticSliderPosition(0, 2)).toBe(0)
    expect(resolveMagneticSliderPosition(1, 2)).toBe(1)
    expect(resolveMagneticSliderPosition(2, 2)).toBe(2)

    const attracted = resolveMagneticSliderPosition(1.1, 2)
    expect(attracted).toBeGreaterThan(1)
    expect(attracted).toBeLessThan(1.1)
    expect(resolveMagneticSliderPosition(1.5, 2)).toBe(1.5)

    expect(resolveMagneticSliderPosition(-1, 2)).toBe(0)
    expect(resolveMagneticSliderPosition(3, 2)).toBe(2)
    expect(resolveMagneticSliderPosition(0.8, 0)).toBe(0)
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

  test('Composer 发送门禁不依赖 Git/Review 状态，非 Git 项目仍可提交', () => {
    expect(resolveComposerCanSubmit(canSubmitInput())).toBe(true)
    expect(
      resolveComposerCanSubmit(
        canSubmitInput({ placement: 'new-session', routedSessionId: null }),
      ),
    ).toBe(true)
    expect(
      resolveComposerCanSubmit(
        canSubmitInput({
          workingPluginSkillUnavailable: true,
          placement: 'new-session',
          routedSessionId: null,
        }),
      ),
    ).toBe(false)
  })

  test('模型未配置与空输入仍禁止提交', () => {
    expect(
      resolveComposerCanSubmit(canSubmitInput({ hasContent: false })),
    ).toBe(false)
    expect(
      resolveComposerCanSubmit(canSubmitInput({ modelConfigured: false })),
    ).toBe(false)
    expect(
      resolveComposerCanSubmit(
        canSubmitInput({ placement: 'thread', routedSessionId: null }),
      ),
    ).toBe(false)
    expect(
      resolveComposerCanSubmit(canSubmitInput({ isSubmitting: true })),
    ).toBe(false)
    expect(
      resolveComposerCanSubmit(canSubmitInput({ hasAttachmentErrors: true })),
    ).toBe(false)
  })
})

function canSubmitInput(
  overrides: Partial<Parameters<typeof resolveComposerCanSubmit>[0]> = {},
): Parameters<typeof resolveComposerCanSubmit>[0] {
  return {
    workingPluginSkillUnavailable: false,
    hasContent: true,
    hasAttachmentErrors: false,
    unsupportedAttachmentReason: null,
    modelConfigured: true,
    isSubmitting: false,
    placement: 'thread',
    routedSessionId: 'session-1',
    ...overrides,
  }
}
