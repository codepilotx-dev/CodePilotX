import { useSyncExternalStore } from 'react'
import type {
  DesktopFilePreview,
  DesktopFileRevision,
} from '../../../shared/types.js'
import {
  desktopClient,
  WORKSPACE_FILE_CHANGED_EVENT,
} from '../../services/desktopClient.js'

const AUTOSAVE_DELAY_MS = 3_000
const EXTERNAL_CHECK_INTERVAL_MS = 4_000

export type FileDocumentConflict = {
  diskContent: string
  diskRevision: DesktopFileRevision
}

export type FileDocumentSnapshot = {
  key: string
  workspacePath: string
  path: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  baseContent: string
  draftContent: string
  revision: DesktopFileRevision | null
  sizeBytes: number
  readonly: boolean
  saving: boolean
  saveError: string | null
  loadError: string | null
  conflict: FileDocumentConflict | null
  dirty: boolean
}

type Listener = () => void

const documents = new Map<string, FileDocumentSnapshot>()
const listeners = new Map<string, Set<Listener>>()
const loadPromises = new Map<string, Promise<FileDocumentSnapshot>>()
const savePromises = new Map<string, Promise<boolean>>()
const autosaveTimers = new Map<string, number>()

export function fileDocumentKey(workspacePath: string, path: string): string {
  return `${workspacePath.replace(/\\/g, '/').toLowerCase()}\u0000${path
    .replace(/\\/g, '/')
    .toLowerCase()}`
}

function initialSnapshot(
  workspacePath: string,
  path: string,
): FileDocumentSnapshot {
  return {
    key: fileDocumentKey(workspacePath, path),
    workspacePath,
    path,
    status: 'idle',
    baseContent: '',
    draftContent: '',
    revision: null,
    sizeBytes: 0,
    readonly: false,
    saving: false,
    saveError: null,
    loadError: null,
    conflict: null,
    dirty: false,
  }
}

function snapshotFor(workspacePath: string, path: string): FileDocumentSnapshot {
  const key = fileDocumentKey(workspacePath, path)
  const existing = documents.get(key)
  if (existing) {
    return existing
  }

  const initial = initialSnapshot(workspacePath, path)
  documents.set(key, initial)
  return initial
}

function publish(next: FileDocumentSnapshot): FileDocumentSnapshot {
  documents.set(next.key, next)
  for (const listener of listeners.get(next.key) ?? []) listener()
  return next
}

function fromPreview(
  current: FileDocumentSnapshot,
  preview: DesktopFilePreview,
): FileDocumentSnapshot {
  return {
    ...current,
    path: preview.path,
    status: 'ready',
    baseContent: preview.content,
    draftContent: preview.content,
    revision: preview.revision,
    sizeBytes: preview.sizeBytes,
    readonly: preview.readonly,
    saving: false,
    saveError: null,
    loadError: null,
    conflict: null,
    dirty: false,
  }
}

export function prefetchFileDocument(
  workspacePath: string,
  path: string,
): Promise<FileDocumentSnapshot> {
  const current = snapshotFor(workspacePath, path)
  if (current.status === 'ready') return Promise.resolve(current)
  const existing = loadPromises.get(current.key)
  if (existing) return existing

  publish({ ...current, status: 'loading', loadError: null })
  const request = desktopClient
    .readWorkspaceFile(workspacePath, path)
    .then(preview => fromPreview(snapshotFor(workspacePath, path), preview))
    .then(publish)
    .catch(error => {
      const failed = publish({
        ...snapshotFor(workspacePath, path),
        status: 'error',
        loadError: error instanceof Error ? error.message : String(error),
      })
      throw error instanceof Error ? error : new Error(String(error))
    })
    .finally(() => loadPromises.delete(current.key))
  loadPromises.set(current.key, request)
  return request
}

export function updateFileDocument(
  workspacePath: string,
  path: string,
  content: string,
): void {
  const current = snapshotFor(workspacePath, path)
  if (current.status !== 'ready' || current.readonly) return
  const next = publish({
    ...current,
    draftContent: content,
    dirty: content !== current.baseContent,
    saveError: null,
  })
  scheduleAutosave(next)
}

function scheduleAutosave(document: FileDocumentSnapshot): void {
  const previous = autosaveTimers.get(document.key)
  if (previous !== undefined) window.clearTimeout(previous)
  if (!document.dirty || document.conflict || document.readonly) {
    autosaveTimers.delete(document.key)
    return
  }
  const timer = window.setTimeout(() => {
    autosaveTimers.delete(document.key)
    void saveFileDocument(document.workspacePath, document.path)
  }, AUTOSAVE_DELAY_MS)
  autosaveTimers.set(document.key, timer)
}

export async function saveFileDocument(
  workspacePath: string,
  path: string,
): Promise<boolean> {
  const key = fileDocumentKey(workspacePath, path)
  const existing = savePromises.get(key)
  if (existing) return existing

  const request = saveUntilClean(workspacePath, path).finally(() =>
    savePromises.delete(key),
  )
  savePromises.set(key, request)
  return request
}

async function saveUntilClean(
  workspacePath: string,
  path: string,
): Promise<boolean> {
  const current = snapshotFor(workspacePath, path)
  if (
    current.status !== 'ready' ||
    current.readonly ||
    current.conflict ||
    !current.revision
  ) {
    return !current.dirty
  }
  if (!current.dirty) return true

  const content = current.draftContent
  const expectedRevision = current.revision
  publish({ ...current, saving: true, saveError: null })
  try {
    const result = await desktopClient.saveWorkspaceFile({
      workspacePath,
      filePath: path,
      content,
      expectedRevision,
    })
    const latest = snapshotFor(workspacePath, path)
    if (result.outcome === 'conflict') {
      publish({
        ...latest,
        saving: false,
        conflict: {
          diskContent: result.content,
          diskRevision: result.revision,
        },
        saveError: '文件已在磁盘上发生变化。',
      })
      return false
    }

    const next = publish({
      ...latest,
      baseContent: content,
      revision: result.revision,
      saving: false,
      saveError: null,
      dirty: latest.draftContent !== content,
    })
    return next.dirty ? saveUntilClean(workspacePath, path) : true
  } catch (error) {
    publish({
      ...snapshotFor(workspacePath, path),
      saving: false,
      saveError: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function checkFileDocumentForExternalChange(
  workspacePath: string,
  path: string,
): Promise<void> {
  const before = snapshotFor(workspacePath, path)
  if (before.status !== 'ready' || before.saving || before.conflict) return
  try {
    const disk = await desktopClient.readWorkspaceFile(workspacePath, path)
    const current = snapshotFor(workspacePath, path)
    if (
      !current.revision ||
      (disk.revision.mtimeMs === current.revision.mtimeMs &&
        disk.revision.sha256 === current.revision.sha256)
    ) {
      return
    }
    if (disk.content === current.baseContent) {
      publish({ ...current, revision: disk.revision, sizeBytes: disk.sizeBytes })
    } else if (disk.content === current.draftContent) {
      publish(fromPreview(current, disk))
    } else {
      publish({
        ...current,
        conflict: {
          diskContent: disk.content,
          diskRevision: disk.revision,
        },
        saveError: '文件已在外部修改。',
      })
    }
  } catch (error) {
    publish({
      ...snapshotFor(workspacePath, path),
      saveError: error instanceof Error ? error.message : String(error),
    })
  }
}

export function useFileDocument(
  workspacePath: string,
  path: string,
): FileDocumentSnapshot {
  const key = fileDocumentKey(workspacePath, path)
  return useSyncExternalStore(
    listener => {
      const bucket = listeners.get(key) ?? new Set<Listener>()
      bucket.add(listener)
      listeners.set(key, bucket)
      return () => {
        bucket.delete(listener)
        if (bucket.size === 0) listeners.delete(key)
      }
    },
    () => snapshotFor(workspacePath, path),
    () => snapshotFor(workspacePath, path),
  )
}

export function startFileDocumentExternalChecks(
  workspacePath: string,
  path: string,
): () => void {
  const check = (): void => {
    if (document.visibilityState !== 'hidden') {
      void checkFileDocumentForExternalChange(workspacePath, path)
    }
  }
  const onChanged = (event: Event): void => {
    const detail = (event as CustomEvent<{ path?: unknown }>).detail
    if (
      typeof detail?.path === 'string' &&
      detail.path.replace(/\\/g, '/').toLowerCase() ===
        path.replace(/\\/g, '/').toLowerCase()
    ) {
      check()
    }
  }
  void desktopClient.watchWorkspaceFile(workspacePath, path).catch(() => undefined)
  const timer = window.setInterval(check, EXTERNAL_CHECK_INTERVAL_MS)
  window.addEventListener('focus', check)
  window.addEventListener(WORKSPACE_FILE_CHANGED_EVENT, onChanged)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('focus', check)
    window.removeEventListener(WORKSPACE_FILE_CHANGED_EVENT, onChanged)
    void desktopClient
      .unwatchWorkspaceFile(workspacePath, path)
      .catch(() => undefined)
  }
}

export function resolveFileDocumentConflict(
  workspacePath: string,
  path: string,
  resolution: 'disk' | 'local' | 'edit',
  mergedContent?: string,
): void {
  const current = snapshotFor(workspacePath, path)
  const conflict = current.conflict
  if (!conflict) return

  if (resolution === 'disk') {
    publish({
      ...current,
      baseContent: conflict.diskContent,
      draftContent: conflict.diskContent,
      revision: conflict.diskRevision,
      conflict: null,
      dirty: false,
      saveError: null,
    })
    return
  }

  const draftContent =
    resolution === 'edit' ? (mergedContent ?? current.draftContent) : current.draftContent
  const next = publish({
    ...current,
    baseContent: conflict.diskContent,
    draftContent,
    revision: conflict.diskRevision,
    conflict: null,
    dirty: draftContent !== conflict.diskContent,
    saveError: null,
  })
  if (resolution === 'local') {
    void saveFileDocument(workspacePath, path)
  } else {
    scheduleAutosave(next)
  }
}

export async function saveAllFileDocuments(): Promise<boolean> {
  const dirty = [...documents.values()].filter(document => document.dirty)
  const results = await Promise.all(
    dirty.map(document =>
      saveFileDocument(document.workspacePath, document.path),
    ),
  )
  return results.every(Boolean)
}

export function hasDirtyFileDocuments(): boolean {
  return [...documents.values()].some(document => document.dirty)
}

export function isFileDocumentDirty(
  workspacePath: string,
  path: string,
): boolean {
  return snapshotFor(workspacePath, path).dirty
}
