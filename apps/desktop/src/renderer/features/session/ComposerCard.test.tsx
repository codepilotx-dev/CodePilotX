import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerCard, CONTEXT_AGENT_OPTIONS } from './ComposerCard.js'
import { ChatInputDropdown, computeDropdownMaxHeight } from './ChatInputDropdown.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { DesktopThemeProvider } from '../theme/themeContext.js'
import type { DesktopComposerAttachment } from '../../../shared/types.js'

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  }
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

test('ComposerCard does not expose plan as a permission-mode control', () => {
  const html = renderWithProviders(<ComposerCard {...baseProps} />)

  expect(html).not.toContain('plan-mode-chip')
  expect(html).not.toContain('plan-mode-chip__exit')
  expect(html).not.toContain('permission-plan-banner')
  expect(html).not.toContain('>计划模式<')
})
