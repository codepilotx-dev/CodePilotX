import { expect, test } from 'bun:test'
import {
  buildDesktopUserMessageContent,
  hasBlockingComposerAttachmentErrors,
} from './desktopUserMessage.js'
import { validateDesktopApiArgs } from './desktopApiSchema.js'
import type { DesktopComposerAttachment } from './types.js'

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

test('buildDesktopUserMessageContent sends images as image blocks and text files as text context', () => {
  expect(
    buildDesktopUserMessageContent({
      text: 'summarize',
      attachments: [imageAttachment, textAttachment],
    }),
  ).toEqual([
    { type: 'text', text: 'summarize' },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'aW1hZ2U=',
      },
    },
    {
      type: 'text',
      text: '<attached_file name="notes.md" media_type="text/markdown" path="C:/tmp/notes.md">\n# Notes\nHello\n</attached_file>',
    },
  ])
})

test('buildDesktopUserMessageContent degrades audio and video files to metadata text', () => {
  const content = buildDesktopUserMessageContent({
    text: '',
    attachments: [
      {
        id: 'att-audio',
        name: 'song.mp3',
        path: 'C:/tmp/song.mp3',
        mediaType: 'audio/mpeg',
        sizeBytes: 1234,
        kind: 'audio',
        status: 'ready',
      },
    ],
  })

  expect(content).toEqual([
    {
      type: 'text',
      text: '<attached_file name="song.mp3" media_type="audio/mpeg" path="C:/tmp/song.mp3" size="1.2 kB">\nBinary media is attached as file metadata because this runtime does not send audio/video bytes directly.\n</attached_file>',
    },
  ])
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
