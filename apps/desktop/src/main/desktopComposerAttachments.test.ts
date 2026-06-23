import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'bun:test'
import {
  classifyDesktopComposerFile,
  readDesktopComposerAttachment,
} from './desktopComposerAttachments.js'

test('classifyDesktopComposerFile recognizes common multimodal file types', () => {
  expect(classifyDesktopComposerFile('photo.png', 'image/png')).toBe('image')
  expect(classifyDesktopComposerFile('paper.pdf', 'application/pdf')).toBe(
    'document',
  )
  expect(classifyDesktopComposerFile('notes.md', 'text/markdown')).toBe('text')
  expect(classifyDesktopComposerFile('song.mp3', 'audio/mpeg')).toBe('audio')
  expect(classifyDesktopComposerFile('clip.mp4', 'video/mp4')).toBe('video')
  expect(classifyDesktopComposerFile('archive.zip', '')).toBe('binary')
})

test('readDesktopComposerAttachment converts text files to inline text content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-attachment-'))
  try {
    const filePath = join(dir, 'notes.md')
    await writeFile(filePath, '# Notes\nHello', 'utf8')

    expect(await readDesktopComposerAttachment(filePath)).toMatchObject({
      name: 'notes.md',
      path: filePath,
      mediaType: 'text/markdown',
      kind: 'text',
      status: 'ready',
      textContent: '# Notes\nHello',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readDesktopComposerAttachment converts images to base64 preview attachments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-attachment-'))
  try {
    const filePath = join(dir, 'photo.png')
    await writeFile(filePath, Buffer.from('image-bytes'))

    expect(await readDesktopComposerAttachment(filePath)).toMatchObject({
      name: 'photo.png',
      path: filePath,
      mediaType: 'image/png',
      kind: 'image',
      status: 'ready',
      contentBase64: Buffer.from('image-bytes').toString('base64'),
      previewDataUrl: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readDesktopComposerAttachment marks oversized image files as blocking errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-attachment-'))
  try {
    const filePath = join(dir, 'huge.png')
    await writeFile(filePath, Buffer.alloc(5))

    expect(
      await readDesktopComposerAttachment(filePath, {
        maxImageBytes: 1,
      }),
    ).toMatchObject({
      name: 'huge.png',
      kind: 'image',
      status: 'error',
      error: 'File is too large for image input.',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
