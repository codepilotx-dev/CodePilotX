import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { DesktopFilePreview } from '../shared/types.js'
import {
  checkFileDocumentForExternalChange,
  prefetchFileDocument,
  startFileDocumentExternalChecks,
} from '../src/features/workspace/fileDocumentStore.js'
import { desktopClient } from '../src/services/desktopClient.js'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'window',
)
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
)

afterEach(() => {
  restoreGlobal('window', originalWindowDescriptor)
  restoreGlobal('document', originalDocumentDescriptor)
})

describe('file document external checks', () => {
  test('retries a prefetch after the first load promise rejects', async () => {
    const workspacePath = 'C:\\workspace\\prefetch-retry'
    const path = 'src\\retry.ts'
    const loaded = preview(path, 'export const retried = true', 1)
    const read = spyOn(desktopClient, 'readWorkspaceFile')
      .mockRejectedValueOnce(new Error('首次读取失败'))
      .mockResolvedValueOnce(loaded)

    await expect(prefetchFileDocument(workspacePath, path)).rejects.toThrow(
      '首次读取失败',
    )
    await expect(
      checkFileDocumentForExternalChange(workspacePath, path),
    ).resolves.toEqual({ status: 'skipped' })
    expect(read).toHaveBeenCalledTimes(1)

    await expect(prefetchFileDocument(workspacePath, path)).resolves.toMatchObject(
      {
        status: 'ready',
        baseContent: loaded.content,
        draftContent: loaded.content,
        loadError: null,
      },
    )
    expect(read).toHaveBeenCalledTimes(2)
    read.mockRestore()
  })

  test('skips documents that have not been loaded', async () => {
    const read = spyOn(desktopClient, 'readWorkspaceFile')
    const result = await checkFileDocumentForExternalChange(
      'C:\\workspace',
      'not-loaded.ts',
    )

    expect(result).toEqual({ status: 'skipped' })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })

  test('keeps ready content and save state when an external read fails', async () => {
    const workspacePath = 'C:\\workspace\\unavailable'
    const path = 'src\\ready.ts'
    const initial = preview(path, 'const ready = true', 1)
    const read = spyOn(desktopClient, 'readWorkspaceFile')
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('文件不存在'))

    await expect(prefetchFileDocument(workspacePath, path)).resolves.toMatchObject(
      {
        status: 'ready',
        baseContent: initial.content,
        draftContent: initial.content,
        saveError: null,
      },
    )

    const result = await checkFileDocumentForExternalChange(workspacePath, path)
    expect(result).toMatchObject({
      status: 'unavailable',
      error: expect.objectContaining({ message: '文件不存在' }),
    })
    await expect(prefetchFileDocument(workspacePath, path)).resolves.toMatchObject(
      {
        status: 'ready',
        baseContent: initial.content,
        draftContent: initial.content,
        saveError: null,
        loadError: null,
      },
    )
    read.mockRestore()
  })

  test('reports one load error per unavailable streak and resets after success', async () => {
    const workspacePath = 'C:\\workspace\\notifications'
    const path = 'src\\watched.ts'
    const initial = preview(path, 'export const watched = true', 1)
    const read = spyOn(desktopClient, 'readWorkspaceFile')
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('第一次失败'))
      .mockRejectedValueOnce(new Error('第二次失败'))
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('恢复后再次失败'))
    const watch = spyOn(
      desktopClient,
      'watchWorkspaceFile',
    ).mockResolvedValue(undefined)
    const unwatch = spyOn(
      desktopClient,
      'unwatchWorkspaceFile',
    ).mockResolvedValue(undefined)
    const windowHarness = installWindowHarness()
    await prefetchFileDocument(workspacePath, path)

    const errors: string[] = []
    const stop = startFileDocumentExternalChecks(workspacePath, path, {
      onLoadError: error => errors.push(error.message),
    })

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败'])

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败'])

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败'])

    await windowHarness.dispatch('focus')
    expect(errors).toEqual(['第一次失败', '恢复后再次失败'])

    stop()
    expect(watch).toHaveBeenCalledWith(workspacePath, path)
    expect(unwatch).toHaveBeenCalledWith(workspacePath, path)
    read.mockRestore()
    watch.mockRestore()
    unwatch.mockRestore()
  })
})

function preview(
  path: string,
  content: string,
  version: number,
): DesktopFilePreview {
  return {
    path,
    content,
    sizeBytes: content.length,
    readonly: false,
    revision: {
      mtimeMs: version,
      sha256: `sha-${version}`,
    },
  }
}

function installWindowHarness(): {
  dispatch: (type: string) => Promise<void>
} {
  const listeners = new Map<string, Set<EventListener>>()
  const fakeWindow = {
    addEventListener(type: string, listener: EventListener) {
      const bucket = listeners.get(type) ?? new Set<EventListener>()
      bucket.add(listener)
      listeners.set(type, bucket)
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener)
    },
    setInterval: () => 1,
    clearInterval: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible' },
  })

  return {
    async dispatch(type) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type))
      }
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

function restoreGlobal(
  key: 'window' | 'document',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor)
  } else {
    Reflect.deleteProperty(globalThis, key)
  }
}
