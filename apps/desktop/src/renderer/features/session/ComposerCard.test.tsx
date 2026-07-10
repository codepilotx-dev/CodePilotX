import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerCard, CONTEXT_AGENT_OPTIONS, getActiveComposerMention } from './ComposerCard.js'
import {
  ChatInputDropdown,
  computeDropdownMaxHeight,
  shouldCloseChatInputDropdownForClick,
} from './ChatInputDropdown.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { DesktopThemeProvider } from '../theme/themeContext.js'
import type { DesktopComposerAttachment } from '../../../shared/types.js'
import {
  getVisiblePermissionModeOptions,
} from '../settings/settingsStorage.js'

const testWindow = typeof globalThis.window === 'undefined'
  ? {}
  : globalThis.window

if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ...testWindow,
    },
  })
}

if (typeof globalThis.window.matchMedia !== 'function') {
  Object.defineProperty(globalThis.window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  })
}

function renderWithProviders(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <DesktopThemeProvider>{node}</DesktopThemeProvider>,
  )
}

const baseProps = {
  input: '',
  canSubmit: true,
  sessionStatus: 'idle' as const,
  permissionMode: 'default' as const,
  thinkingMode: 'default' as const,
  selectedProviderID: 'minimax',
  selectedModelPreset: 'abab6.5s-chat',
  showThinkingOptions: false,
  deepSeekThinkingControls: false,
  showContextUsage: false,
  contextUsage: null,
  modelPresets: [
    { id: 'abab6.5s-chat', label: 'abab6.5s-chat', value: 'abab6.5s-chat' },
  ],
  providerOptions: [],
  permissionOptions: [{ value: 'default' as const, label: 'Default' }],
  thinkingOptions: [{ value: 'default' as const, label: 'Default' }],
  branchName: 'master',
  branches: [],
  recentWorkspaces: [],
  workspace: null,
  onChooseWorkspace: () => {},
  onInputChange: () => {},
  onInterrupt: () => {},
  onProviderModelChange: () => {},
  onOpenFiles: () => {},
  onOpenWorkspace: () => {},
  onClearWorkspace: () => {},
  onBranchSelect: () => {},
  onCreateBranch: () => {},
  onPermissionChange: () => {},
  onSubmit: () => {},
  onThinkingChange: () => {},
}

test('ComposerCard renders image and file attachment cards above the textarea', () => {
  const attachments: DesktopComposerAttachment[] = [
    {
      id: 'image-1',
      name: 'screen.png',
      path: 'C:/tmp/screen.png',
      mediaType: 'image/png',
      sizeBytes: 10,
      kind: 'image',
      status: 'ready',
      previewDataUrl: 'data:image/png;base64,c2NyZWVu',
      contentBase64: 'c2NyZWVu',
    },
    {
      id: 'file-1',
      name: 'demo.mp4',
      path: 'C:/tmp/demo.mp4',
      mediaType: 'video/mp4',
      sizeBytes: 20,
      kind: 'video',
      status: 'ready',
    },
  ]

  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      attachments={attachments}
      onRemoveAttachment={() => {}}
    />,
  )

  expect(html).toContain('composer-attachments')
  expect(html).toContain('composer-attachment-card composer-attachment-image ready')
  expect(html).toContain('composer-attachment-card composer-attachment-video ready')
  expect(html).toContain('screen.png')
  expect(html).toContain('demo.mp4')
  expect(html).toContain('MP4')
  expect(html).toContain('composer-attachment-preview')
  expect(html).toContain('composer-attachment-body')
})

test('ComposerCard exposes the migrated chat input dropdown agents', () => {
  expect(CONTEXT_AGENT_OPTIONS).toEqual([
    { name: 'Schrodinger', role: 'explorer', icon: 'DNA', tone: 'red' },
    { name: 'Russell', role: 'explorer', icon: 'ATOM', tone: 'amber' },
  ])
})

test('ChatInputDropdown adds --bottom modifier class when side is "bottom"', () => {
  const html = renderToStaticMarkup(
    <ChatInputDropdown open onClose={() => {}} side="bottom" width={320}>
      <span>item</span>
    </ChatInputDropdown>,
  )
  expect(html).toContain('chat-input__dropdown--bottom')
})

test('ComposerCard groups reference items, sub-agents, and plugins separately', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      input="/"
      slashCommands={[
        {
          name: 'status',
          title: '状态',
          description: '显示 CodePilotX 状态',
          category: 'command',
        },
      ]}
    />,
  )

  expect(html).toContain('popover-surface chat-input__dropdown chat-input__dropdown--bottom')
  expect(html).toContain('--popover-max-width:100%')
  // Unified menu uses one group for all available actions.
  expect(html).toContain('>添加<')
  expect(html.match(/chat-input__dropdown-section-title/g)?.length).toBe(3)
  expect(html).toContain('IDE 上下文')
  expect(html).toContain('MCP')
  expect(html).toContain('代码审查')
  expect(html).toContain('初始化')
  expect(html).toContain('反馈')
  expect(html).toContain('宠物')
  expect(html).toContain('新工作树')
  expect(html).toContain('模型')
  expect(html).toContain('状态')
  expect(html).toContain('记忆')
  expect(html).not.toContain('chat-input__dropdown-section-title">目标<')
  expect(html).not.toContain('chat-input__dropdown-section-title">计划模式<')
  expect(html).toContain('chat-input__dropdown-section-label">子智能体<')
  expect(html).toContain('chat-input__dropdown-section-label">插件<')
  expect(html).not.toContain('chat-input__dropdown-section-title">命令<')
  expect(html).not.toContain('chat-input__dropdown-section-label">技能<')
  // Each group contains expected items
  expect(html).toContain('Files and folders')
  expect(html).toContain('Schrodinger')
  expect(html).toContain('Documents')
  expect(html).toContain('状态')
})

test('ComposerCard shows full slash command list when input is "/ "', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      input="/ "
      slashCommands={[
        {
          name: 'status',
          title: '状态',
          description: '显示状态',
          category: 'command',
        },
      ]}
    />,
  )

  expect(html).toContain('状态')
})

test('ComposerCard filters slash commands by keyword', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      input="/计"
      slashCommands={[
        {
          name: 'plan',
          title: '计划模式',
          description: '开启计划模式',
          category: 'command',
        },
        {
          name: 'status',
          title: '状态',
          description: '显示状态',
          category: 'command',
        },
      ]}
    />,
  )

  expect(html).toContain('计划模式')
  expect(html).not.toContain('状态')
})

test('ComposerCard filters slash commands by name as well as title', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      input="/plan"
      slashCommands={[
        {
          name: 'goal',
          title: '目标',
          description: '设置目标',
          category: 'command',
        },
        {
          name: 'plan',
          title: '计划模式',
          description: '开启计划模式',
          category: 'command',
        },
      ]}
    />,
  )

  expect(html).toContain('计划模式')
  expect(html).not.toContain('目标')
})

test('ComposerCard shows no commands when no slash commands match', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      input="/xyz"
      slashCommands={[
        {
          name: 'status',
          title: '状态',
          description: '显示状态',
          category: 'command',
        },
      ]}
    />,
  )

  expect(html).toContain('无命令')
  expect(html).not.toContain('状态')
})

test('ComposerCard shows the 技能 group when skill commands are available', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      input="/"
      slashCommands={[
        {
          name: 'status',
          title: '状态',
          description: '显示状态',
          category: 'command',
        },
        {
          name: 'mmx-cli',
          title: 'Mmx CLI',
          description: 'MiniMax AI platform',
          category: 'skill',
          skillPath: 'C:\\Users\\test\\.agents\\skills\\mmx-cli\\SKILL.md',
        },
      ]}
    />,
  )

  // Skills render under their own group while sub-agents and plugins have dedicated groups.
  expect(html).toContain('chat-input__dropdown-section-label">添加<')
  expect(html).toContain('chat-input__dropdown-section-label">子智能体<')
  expect(html).toContain('chat-input__dropdown-section-label">插件<')
  expect(html).toContain('chat-input__dropdown-section-label">技能<')
  expect(html.match(/chat-input__dropdown-section-title/g)?.length).toBe(4)
  expect(html).toContain('状态')
  expect(html).toContain('Mmx CLI')
})

test('ComposerCard renders inline skill token when selectedSkillToken is provided', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      selectedSkillToken={{
        name: 'mmx-cli',
        title: 'Mmx CLI',
        description: 'MiniMax AI platform',
        category: 'skill',
        skillPath: 'C:\\Users\\XiaoHi\\.agents\\skills\\mmx-cli\\SKILL.md',
      }}
    />,
  )

  expect(html).toContain('composer-skill-token')
  expect(html).toContain('composer-skill-token-label')
  expect(html).toContain('Mmx CLI')
  // Inline skill token has no close button
  expect(html).not.toContain('composer-skill-tag-remove')
  // Markdown link should not appear in textarea value
  expect(html).not.toContain('SKILL.md')
})

test('ComposerCard does not render inline skill token when no skill is selected', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      selectedSkillToken={undefined}
    />,
  )

  expect(html).not.toContain('composer-skill-token')
})

test('getActiveComposerMention detects @ at start of line', () => {
  expect(getActiveComposerMention('@mmx', 4)).toEqual({
    start: 0,
    end: 4,
    query: 'mmx',
  })
})

test('getActiveComposerMention detects @ after whitespace', () => {
  expect(getActiveComposerMention('hello @mmx', 10)).toEqual({
    start: 6,
    end: 10,
    query: 'mmx',
  })
})

test('getActiveComposerMention returns null for @midword', () => {
  expect(getActiveComposerMention('email@example.com', 16)).toBeNull()
})

test('getActiveComposerMention returns null for query with space', () => {
  expect(getActiveComposerMention('@mmx cli', 8)).toBeNull()
})

test('getActiveComposerMention returns null when cursor not at end of mention', () => {
  expect(getActiveComposerMention('@mmx hello', 3)).toBeNull()
})

test('getActiveComposerMention returns null when selectionStart is null', () => {
  expect(getActiveComposerMention('@mmx', null)).toBeNull()
})

test('getActiveComposerMention returns null for empty input', () => {
  expect(getActiveComposerMention('', 0)).toBeNull()
})

test('ComposerCard shows running state stop button with Esc tooltip', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      sessionStatus="running"
    />,
  )

  expect(html).toContain('停止 Esc')
  expect(html).toContain('lucide-square')
  expect(html).not.toContain('lucide-arrow-up')
})

test('computeDropdownMaxHeight clamps dropdown height to remaining page space', () => {
  const safetyMargin = 16

  // side="bottom": 800px viewport, anchor top at 200 → 584px available, capped at 420
  expect(computeDropdownMaxHeight({
    side: 'bottom',
    anchorTop: 200,
    windowHeight: 800,
    maxCap: 420,
    safetyMargin,
  })).toBe(420)

  // side="bottom": 300px viewport, anchor top at 200 → 84px available after margin
  expect(computeDropdownMaxHeight({
    side: 'bottom',
    anchorTop: 200,
    windowHeight: 300,
    maxCap: 420,
    safetyMargin,
  })).toBe(84)

  // side="bottom": 800px viewport, anchor top at 50 → huge available but capped at 420
  expect(computeDropdownMaxHeight({
    side: 'bottom',
    anchorTop: 50,
    windowHeight: 800,
    maxCap: 420,
    safetyMargin,
  })).toBe(420)

  // side="top": anchor top at 200 → 184px above, no cap hit
  expect(computeDropdownMaxHeight({
    side: 'top',
    anchorTop: 200,
    windowHeight: 800,
    maxCap: 420,
    safetyMargin,
  })).toBe(184)

  // side="top": anchor top at 50 → only 34px, very small
  expect(computeDropdownMaxHeight({
    side: 'top',
    anchorTop: 50,
    windowHeight: 800,
    maxCap: 420,
    safetyMargin,
  })).toBe(34)
})

test('IconButton forwards Radix trigger attributes for dropdown controls', () => {
  const html = renderToStaticMarkup(
    <IconButton aria-expanded="true" data-state="open" title="添加上下文">
      +
    </IconButton>,
  )

  expect(html).toContain('aria-expanded="true"')
  expect(html).toContain('data-state="open"')
})

test('ComposerCard renders active plan mode as a separate toolbar chip', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      permissionMode="default"
      planModeActive={true}
      permissionOptions={[
        { value: 'default' as const, label: '默认权限' },
      ]}
    />,
  )

  expect(html).toContain('composer-plan-mode-chip active')
  expect(html).toContain('Describe your task to generate a plan...')
  expect(html).toContain('>计划<')
  expect(html).toContain('>默认权限<')
  expect(html).not.toContain('permission-chip-plan')
})

test('ComposerCard exposes narrow-width composer chip labels for CSS collapse', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      permissionMode="full-access"
      showThinkingOptions={true}
      selectedModelPreset="abab6.5s-chat"
      permissionOptions={[
        { value: 'full-access' as const, label: '完全访问' },
      ]}
      thinkingOptions={[
        { value: 'default' as const, label: '高' },
      ]}
      workspace={{
        path: 'D:\\VueProject\\ClaudeCode',
        name: 'ClaudeCode',
      }}
      branchName="codex/codex-compatible-convergence"
    />,
  )

  expect(html).toContain('composer-model-chip-label')
  expect(html).toContain('composer-model-chip-thinking')
  expect(html).toContain('>abab6.5s-chat<')
  expect(html).toContain('>高<')
  expect(html).toContain('permission-select-trigger-label')
  expect(html).toContain('>完全访问<')
  expect(html).toContain('>ClaudeCode<')
  expect(html).toContain('>本地模式<')
  expect(html).toContain('>codex/codex-compatible-convergence<')
})

test('getVisiblePermissionModeOptions hides gated permission modes', () => {
  const defaultOnly = getVisiblePermissionModeOptions({
    enableAutoReviewPermissionMode: false,
    enableFullAccessPermissionMode: false,
  })
  expect(defaultOnly.map(option => option.value)).toEqual(['default'])

  const allEnabled = getVisiblePermissionModeOptions({
    enableAutoReviewPermissionMode: true,
    enableFullAccessPermissionMode: true,
  })
  expect(allEnabled.map(option => option.value)).toEqual([
    'default',
    'auto-review',
    'full-access',
  ])
  expect(allEnabled.map(option => option.value)).not.toContain('custom')
})

test('ChatInputDropdown renders width custom properties when sizes are provided', () => {
  const html = renderToStaticMarkup(
    <ChatInputDropdown open width={360} maxWidth="calc(100vw - 32px)" onClose={() => {}}>
      <span>item</span>
    </ChatInputDropdown>,
  )

  expect(html).toContain('--popover-width:360px')
  expect(html).toContain('--popover-max-width:calc(100vw - 32px)')
})

test('ChatInputDropdown ignores outside clicks when outside dismissal is disabled', () => {
  const outsideTarget = {
    closest: () => null,
  } as unknown as HTMLElement

  expect(
    shouldCloseChatInputDropdownForClick(outsideTarget, {
      disableOutsideDismiss: true,
    }),
  ).toBe(false)
})

test('ChatInputDropdown still closes on outside clicks by default', () => {
  const outsideTarget = {
    closest: () => null,
  } as unknown as HTMLElement

  expect(shouldCloseChatInputDropdownForClick(outsideTarget)).toBe(true)
})

test('ComposerCard shows model catalog loading in composer and model chip', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      modelCatalogLoading={true}
      providerOptions={[
        {
          providerID: 'minimax',
          displayName: 'MiniMax',
          modelPresets: [
            {
              id: 'abab6.5s-chat',
              label: 'abab6.5s-chat',
              value: 'abab6.5s-chat',
            },
          ],
        },
      ]}
    />,
  )

  expect(html).toContain('placeholder="加载模型列表中……"')
  expect(html).toContain('composer-model-loading-spinner')
  expect(html).toContain('>加载模型列表中……<')
})

test('ComposerCard labels selected provider model instead of custom fallback', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      selectedProviderID="deepseek"
      selectedModelPreset="deepseek-v4-pro"
      modelPresets={[]}
      providerOptions={[
        {
          providerID: 'deepseek',
          displayName: 'DeepSeek',
          modelPresets: [
            {
              id: 'deepseek-v4-pro',
              label: 'DeepSeek V4 Pro',
              value: 'deepseek-v4-pro',
            },
          ],
        },
      ]}
    />,
  )

  expect(html).toContain('>DeepSeek V4 Pro<')
  expect(html).not.toContain('>自定义模型<')
})

test('ComposerCard shows unselected model state for unmatched legacy custom preset', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      selectedModelPreset="__custom__"
      modelPresets={[]}
      providerOptions={[]}
    />,
  )

  expect(html).toContain('>未选择模型<')
  expect(html).not.toContain('>deepseek-chat<')
  expect(html).not.toContain('>自定义模型<')
})

test('ComposerCard renders context usage chip with progress ring CSS variable and accessible label', () => {
  const html = renderWithProviders(
    <ComposerCard
      {...baseProps}
      showContextUsage={true}
      contextUsage={{
        model: 'abab6.5s-chat',
        provider: 'MiniMax',
        contextWindow: 8000,
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 20,
        cacheReadInputTokens: 30,
        reasoningTokens: 10,
        promptCacheHitTokens: 30,
        promptCacheMissTokens: 10,
        usedTokens: 200,
        remainingTokens: 7800,
        usedPercent: 36,
        remainingPercent: 64,
      }}
    />,
  )

  expect(html).toContain('context-usage-chip')
  expect(html).toContain('chip-dot')
  expect(html).toContain('--context-usage-progress:36')
  expect(html).toContain('上下文窗口使用量：已用 36%，剩余 64%')
  expect(html).toContain('已用 36%，剩余 64%')
  expect(html).toContain('abab6.5s-chat')
  expect(html).toContain('MiniMax')
})

test('ComposerCard shows fallback when showContextUsage is true but contextUsage is null', () => {
	  const html = renderWithProviders(
	    <ComposerCard
	      {...baseProps}
	      showContextUsage={true}
	      contextUsage={null}
	    />,
	  )
	
	  expect(html).toContain('context-usage-chip')
	  expect(html).toContain('chip-dot')
	  expect(html).toContain('--context-usage-progress:0')
	  expect(html).toContain('上下文窗口使用量：暂无数据')
	  expect(html).toContain('暂无上下文统计')
	})

test('ComposerCard renders goal mode chip when goalModeEnabled is true', () => {
	  const html = renderWithProviders(
	    <ComposerCard
	      {...baseProps}
	      goalModeEnabled={true}
	      onGoalModeChange={() => {}}
	    />,
	  )
	
	  expect(html).toContain('composer-plan-mode-chip active')
	  expect(html).toContain('>目标<')
	  expect(html).toContain('目标模式')
	})

test('ComposerCard shows goal mode placeholder when goalModeEnabled is true', () => {
	  const html = renderWithProviders(
	    <ComposerCard
	      {...baseProps}
	      goalModeEnabled={true}
	      onGoalModeChange={() => {}}
	    />,
	  )
	
	  expect(html).toContain('placeholder="粘贴你的计划或目标…"')
	})

test('ComposerCard does not render goal mode chip when goalModeEnabled is false', () => {
	  const html = renderWithProviders(
	    <ComposerCard {...baseProps} />,
	  )
	
	  expect(html).not.toContain('>目标<')
	  expect(html).not.toContain('目标模式')
	})

test('ComposerCard renders target icon in goal mode toolbar chip', () => {
	  const html = renderWithProviders(
	    <ComposerCard
	      {...baseProps}
	      goalModeEnabled={true}
	      onGoalModeChange={() => {}}
	    />,
	  )
	
	  // The goal mode toolbar chip uses the Target icon
	  expect(html).toContain('lucide-target')
	  expect(html).toContain('composer-plan-mode-chip-icon-plan')
	})

test('ComposerCard goal mode and plan mode chips are independent', () => {
	  const html = renderWithProviders(
	    <ComposerCard
	      {...baseProps}
	      goalModeEnabled={true}
	      onGoalModeChange={() => {}}
	      planModeActive={true}
	    />,
	  )
	
	  // Both chips should appear independently
	  expect(html).toContain('>目标<')
	  expect(html).toContain('>计划<')
	})

test('getActiveComposerMention detects @brain for skill filtering', () => {
	  expect(getActiveComposerMention('@brain', 6)).toEqual({
	    start: 0,
	    end: 6,
	    query: 'brain',
	  })
	})

test('ComposerCard unified menu filters by Chinese keyword "/计" across all groups', () => {
	  const html = renderWithProviders(
	    <ComposerCard
	      {...baseProps}
	      input="/计"
	      slashCommands={[
	        { name: 'plan', title: '计划模式', description: '开启计划模式', category: 'command' },
	        { name: 'status', title: '状态', description: '显示状态', category: 'command' },
	      ]}
	    />,
	  )

	  // 计划模式 from 计划模式 group matches keyword "计"
	  expect(html).toContain('>计划模式<')
	  // 状态 does not contain "计" → hidden
	  expect(html).not.toContain('>状态<')
	  // Hardcoded items without "计" are also hidden
	  expect(html).not.toContain('Files and folders')
	  expect(html).not.toContain('Schrodinger')
	  expect(html).not.toContain('Documents')
	})

test('ComposerCard unified menu filters by English keyword across hardcoded and command items', () => {
	  const html = renderWithProviders(
	    <ComposerCard
	      {...baseProps}
	      input="/goal"
	    />,
	  )

  // 目标 item matches "goal" in matchText while keeping the 添加 heading.
  expect(html).toContain('>目标<')
  expect(html).toContain('>添加<')
  expect(html).not.toContain('>Files and folders<')
  expect(html).not.toContain('>Schrodinger<')
  expect(html).not.toContain('>Documents<')
	})
