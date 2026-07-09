import { expect, test } from 'bun:test'
import {
  buildDesktopUserMessageContent,
  hasBlockingComposerAttachmentErrors,
  desktopAttachmentToAttachment,
} from './desktopUserMessage.js'
import { validateDesktopApiArgs } from './desktopApiSchema.js'
import type { DesktopComposerAttachment, DesktopUserMessageContent } from './types.js'
import type { UserMessage } from '@codepilotx/core/attachments/types.js'

const imageAttachment: DesktopComposerAttachment = {
  id: 'att-image',
  name: 'diagram.png',
  path: 'C:/tmp/diagram.png',
  mediaType: 'image/png',
  sizeBytes: 12,
  kind: 'image',
  status: 'ready',
  contentBase64: 'aW1hZ2U=',
  previewDataUrl: 'data:image/png;base64,aW1hZ2U=',
}

const textAttachment: DesktopComposerAttachment = {
  id: 'att-text',
  name: 'notes.md',
  path: 'C:/tmp/notes.md',
  mediaType: 'text/markdown',
  sizeBytes: 18,
  kind: 'text',
  status: 'ready',
  textContent: '# Notes\nHello',
}

function expectUserMessage(content: DesktopUserMessageContent): UserMessage {
  expect(typeof content).toBe('object')
  return content as UserMessage
}

test('desktop sendUserMessage schema accepts structured user message input', () => {
  expect(() =>
    validateDesktopApiArgs('sendUserMessage', [
      'session-1',
      {
        text: 'explain these files',
        attachments: [imageAttachment, textAttachment],
      },
      'claude-sonnet',
    ]),
  ).not.toThrow()
})

test('desktop sendUserMessage schema rejects invalid attachment payloads', () => {
  expect(() =>
    validateDesktopApiArgs('sendUserMessage', [
      'session-1',
      {
        text: 'bad',
        attachments: [{ id: 'broken', kind: 'image', status: 'ready' }],
      },
    ]),
  ).toThrow()
})

test('buildDesktopUserMessageContent strips UI fields and keeps neutral attachment data', () => {
  const result = expectUserMessage(buildDesktopUserMessageContent({
    text: 'summarize',
    attachments: [imageAttachment, textAttachment],
  }))

  expect(result.text).toBe('summarize')
  expect(result.attachments).toHaveLength(2)
  expect(result.attachments![0]).toEqual({
    kind: 'image',
    name: 'diagram.png',
    path: 'C:/tmp/diagram.png',
    mediaType: 'image/png',
    sizeBytes: 12,
    contentBase64: 'aW1hZ2U=',
    textContent: undefined,
  })
  expect(result.attachments![1]).toEqual({
    kind: 'text',
    name: 'notes.md',
    path: 'C:/tmp/notes.md',
    mediaType: 'text/markdown',
    sizeBytes: 18,
    contentBase64: undefined,
    textContent: '# Notes\nHello',
  })
  // Ensure UI-only fields are stripped
  expect((result.attachments![0] as Record<string, unknown>).id).toBeUndefined()
  expect((result.attachments![0] as Record<string, unknown>).status).toBeUndefined()
  expect((result.attachments![0] as Record<string, unknown>).previewDataUrl).toBeUndefined()
})

test('buildDesktopUserMessageContent strips error attachments and maintains text with skill', () => {
  const result = expectUserMessage(buildDesktopUserMessageContent({
    text: 'analyze',
    attachments: [
      imageAttachment,
      {
        ...imageAttachment,
        id: 'att-error',
        status: 'error',
        error: 'too large',
      },
    ],
    skillInvocation: { name: 'test-skill' },
  }))

  expect(result.text).toContain('/test-skill')
  expect(result.text).toContain('analyze')
  // Error attachment filtered out
  expect(result.attachments).toHaveLength(1)
  expect(result.attachments![0].name).toBe('diagram.png')
})

test('buildDesktopUserMessageContent handles no attachments', () => {
  const result = expectUserMessage(buildDesktopUserMessageContent({
    text: 'hello',
  }))

  expect(result.text).toBe('hello')
  expect(result.attachments).toHaveLength(0)
})

test('desktopAttachmentToAttachment strips UI-only fields', () => {
  const result = desktopAttachmentToAttachment(imageAttachment)

  expect(result.kind).toBe('image')
  expect(result.name).toBe('diagram.png')
  expect(result.path).toBe('C:/tmp/diagram.png')
  expect(result.mediaType).toBe('image/png')
  expect(result.sizeBytes).toBe(12)
  expect(result.contentBase64).toBe('aW1hZ2U=')
  // UI-only fields must be absent
  expect('id' in result).toBe(false)
  expect('status' in result).toBe(false)
  expect('previewDataUrl' in result).toBe(false)
  expect('truncated' in result).toBe(false)
})

test('hasBlockingComposerAttachmentErrors blocks errored attachments only', () => {
  expect(hasBlockingComposerAttachmentErrors([imageAttachment])).toBe(false)
  expect(
    hasBlockingComposerAttachmentErrors([
      {
        ...imageAttachment,
        id: 'att-error',
        status: 'error',
        error: 'File is too large',
      },
    ]),
  ).toBe(true)
})
