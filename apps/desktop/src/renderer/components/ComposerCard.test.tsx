import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerCard } from './ComposerCard.js'
import type { DesktopComposerAttachment } from '../../shared/types.js'

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

  const html = renderToStaticMarkup(
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
