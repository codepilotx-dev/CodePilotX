import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerCard, CONTEXT_AGENT_OPTIONS } from './ComposerCard.js'
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

if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
    },
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
  expect(html).toContain('screen.png')
  expect(html).toContain('demo.mp4')
  expect(html).toContain('MP4')
})

test('ComposerCard exposes the migrated chat input dropdown agents', () => {
  expect(CONTEXT_AGENT_OPTIONS).toEqual([
    { name: 'Schrodinger', role: 'explorer', icon: 'DNA', tone: 'red' },
    { name: 'Russell', role: 'explorer', icon: 'ATOM', tone: 'amber' },
  ])
})

test('ChatInputDropdown adds --bottom modifier class when side is "bottom"', () => {
  const html = renderToStaticMarkup(
    <ChatInputDropdown open onClose={() => {}} side="bottom">
      <span>item</span>
    </ChatInputDropdown>,
  )
  expect(html).toContain('chat-input__dropdown--bottom')
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
