import * as Dialog from '@radix-ui/react-dialog'
import {
  Folder,
  FolderPlus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type {
  DesktopProjectFolder,
  DesktopWorkspace,
  ProjectAppearance,
} from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { cx } from '../../utils/cx.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { ProjectAppearancePicker } from './ProjectAppearancePicker.js'
import {
  createProjectFolderSavePlan,
  type ProjectFolderSaveDraft,
} from './projectEditModel.js'
import { notifyProjectCatalogChanged } from './projectCatalogEvents.js'

type DraftFolder = DesktopProjectFolder & ProjectFolderSaveDraft

type Props = {
  appearance: ProjectAppearance
  open: boolean
  project: DesktopWorkspace
  onAppearanceChange: (appearance: ProjectAppearance) => void
  onOpenChange: (open: boolean) => void
  onProjectChange: (project: DesktopWorkspace) => void
  onReport: (message: string) => void
  onRequestRemove: () => void
}

export function ProjectEditDialog({
  appearance,
  open,
  project,
  onAppearanceChange,
  onOpenChange,
  onProjectChange,
  onReport,
  onRequestRemove,
}: Props): React.ReactNode {
  const [draftName, setDraftName] = useState(project.name)
  const [draftAppearance, setDraftAppearance] = useState(appearance)
  const [draftFolders, setDraftFolders] = useState<DraftFolder[]>(() =>
    createFolderDraft(project),
  )
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const projectId = project.projectId

  useEffect(() => {
    if (!open) return
    setDraftName(project.name)
    setDraftFolders(createFolderDraft(project))
    setBusy(false)
  }, [open, project])

  useEffect(() => {
    if (!open) return
    setDraftAppearance(appearance)
  }, [appearance, open])

  useEffect(() => {
    if (!open) return
    if (!projectId) return
    void desktopClient
      .listProjectSources(projectId)
      .then(sources => {
        const counts: Record<string, number> = {}
        for (const source of sources) {
          if (source.storage !== 'workspace-file') continue
          counts[source.folderId] = (counts[source.folderId] ?? 0) + 1
        }
        setSourceCounts(counts)
      })
      .catch(error => onReport(errorMessage(error)))
  }, [open, projectId, onReport])

  const primaryDraft = useMemo(
    () => draftFolders.find(folder => folder.role === 'primary') ?? null,
    [draftFolders],
  )

  async function addFolder(): Promise<void> {
    const path = await desktopClient.chooseProjectFolder()
    if (!path) return
    if (draftFolders.some(folder => samePath(folder.path, path))) {
      onReport('该目录已经在项目中。')
      return
    }
    setDraftFolders(current => [
      ...current,
      createNewDraftFolder(path, current.length),
    ])
  }

  async function reselectFolder(folder: DraftFolder): Promise<void> {
    const path = await desktopClient.chooseProjectFolder()
    if (!path) return
    if (
      draftFolders.some(
        candidate => candidate.id !== folder.id && samePath(candidate.path, path),
      )
    ) {
      onReport('该目录已经在项目中。')
      return
    }
    const affectedSources = folder.originalId
      ? sourceCounts[folder.originalId] ?? 0
      : 0
    if (
      affectedSources > 0
      && !window.confirm(
        `重新选择目录会移除原目录下的 ${affectedSources} 个路径来源，是否继续？`,
      )
    ) {
      return
    }
    setDraftFolders(current =>
      current.map(candidate =>
        candidate.id === folder.id
          ? {
              ...createNewDraftFolder(path, candidate.order),
              role: candidate.role,
            }
          : candidate,
      ),
    )
  }

  function setPrimary(folderId: string): void {
    setDraftFolders(current =>
      current.map(folder => ({
        ...folder,
        role: folder.id === folderId ? 'primary' : 'secondary',
      })),
    )
  }

  function removeFolder(folder: DraftFolder): void {
    if (folder.role === 'primary') return
    const affectedSources = folder.originalId
      ? sourceCounts[folder.originalId] ?? 0
      : 0
    if (
      affectedSources > 0
      && !window.confirm(
        `移除此目录会同时移除 ${affectedSources} 个路径来源，是否继续？`,
      )
    ) {
      return
    }
    setDraftFolders(current =>
      current.filter(candidate => candidate.id !== folder.id),
    )
  }

  async function refreshProject(): Promise<void> {
    if (!projectId) return
    const refreshed = (await desktopClient.listProjects()).find(
      item => item.projectId === projectId,
    )
    if (refreshed) onProjectChange(refreshed)
  }

  async function save(): Promise<void> {
    if (!projectId || busy || !draftName.trim() || !primaryDraft) return
    setBusy(true)
    let current = project
    try {
      const savePlan = createProjectFolderSavePlan(
        project.folders ?? [],
        draftFolders,
      )
      for (const path of savePlan.addPaths) {
        current = await desktopClient.addProjectFolder(projectId, path)
      }

      const desiredPrimary = current.folders?.find(folder =>
        samePath(folder.path, savePlan.desiredPrimaryPath),
      )
      if (!desiredPrimary) {
        throw new Error('保存后未找到选定的主目录。')
      }
      if (current.primaryFolderId !== desiredPrimary.id) {
        current = await desktopClient.setPrimaryProjectFolder(
          projectId,
          desiredPrimary.id,
        )
      }

      for (const folderId of savePlan.removeFolderIds) {
        const existing = current.folders?.find(folder => folder.id === folderId)
        if (!existing) continue
        if (existing.role === 'primary') {
          throw new Error('必须先选择其他目录作为主目录。')
        }
        current = await desktopClient.removeProjectFolder(projectId, folderId)
      }

      if (draftName.trim() !== current.name) {
        current = await desktopClient.updateProject({
          projectId,
          name: draftName.trim(),
          expectedVersion: current.projectVersion ?? 0,
        })
      }

      onProjectChange(current)
      notifyProjectCatalogChanged()
      onOpenChange(false)
      onReport('项目已保存。')
    } catch (error) {
      await refreshProject().catch(() => undefined)
      notifyProjectCatalogChanged()
      onReport(
        `部分项目更改可能已经生效，已刷新实际状态。${errorMessage(error)}`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={nextOpen => {
      if (!busy) onOpenChange(nextOpen)
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="project-edit-backdrop" />
        <Dialog.Content
          aria-describedby={undefined}
          className="project-edit-dialog"
          onOpenAutoFocus={event => {
            event.preventDefault()
            requestAnimationFrame(() => {
              document
                .querySelector<HTMLInputElement>('.project-edit-name-input')
                ?.focus()
            })
          }}
        >
          <header className="project-edit-header">
            <Dialog.Title>编辑项目</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭编辑项目"
                className="project-edit-close"
                disabled={busy}
                type="button"
              >
                <X
                  size={APP_ICON_SIZE + 2}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </button>
            </Dialog.Close>
          </header>

          {!projectId ? (
            <p className="project-edit-empty">当前任务尚未关联稳定项目。</p>
          ) : (
            <>
              <div className="project-edit-name-field">
                <ProjectAppearancePicker
                  appearance={draftAppearance}
                  disabled={busy}
                  onChange={nextAppearance => {
                    setDraftAppearance(nextAppearance)
                    onAppearanceChange(nextAppearance)
                  }}
                />
                <input
                  aria-label="项目名称"
                  className="project-edit-name-input"
                  maxLength={120}
                  value={draftName}
                  onChange={event => setDraftName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') void save()
                  }}
                />
              </div>

              <section className="project-edit-folders">
                <h3>源文件夹</h3>
                <div className="project-edit-folder-list">
                  {draftFolders.map(folder => (
                    <div
                      className={cx(
                        'project-edit-folder-row',
                        folder.availability === 'missing' && 'is-missing',
                      )}
                      key={folder.id}
                    >
                      <Folder size={APP_ICON_SIZE + 2} />
                      <div className="project-edit-folder-copy">
                        <strong>{folder.name}</strong>
                        <span title={folder.path}>{folder.path}</span>
                      </div>
                      {folder.role === 'primary' ? (
                        <span className="project-edit-primary-badge">主目录</span>
                      ) : (
                        <button
                          aria-label={`将 ${folder.name} 设为主目录`}
                          className="project-edit-folder-action"
                          disabled={busy}
                          title="设为主目录"
                          type="button"
                          onClick={() => setPrimary(folder.id)}
                        >
                          <Star size={APP_ICON_SIZE} />
                        </button>
                      )}
                      {folder.availability === 'missing' ? (
                        <button
                          aria-label={`重新选择目录 ${folder.name}`}
                          className="project-edit-folder-action"
                          disabled={busy}
                          title="重新选择目录"
                          type="button"
                          onClick={() => void reselectFolder(folder)}
                        >
                          <RefreshCw size={APP_ICON_SIZE} />
                        </button>
                      ) : null}
                      <button
                        aria-label={`移除目录 ${folder.name}`}
                        className="project-edit-folder-action"
                        disabled={busy || folder.role === 'primary'}
                        title={
                          folder.role === 'primary'
                            ? '请先设置其他主目录'
                            : '从项目移除'
                        }
                        type="button"
                        onClick={() => removeFolder(folder)}
                      >
                        <X size={APP_ICON_SIZE} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="project-edit-add-folder"
                    disabled={busy}
                    type="button"
                    onClick={() => void addFolder()}
                  >
                    <FolderPlus size={APP_ICON_SIZE + 2} />
                    添加文件夹
                  </button>
                </div>
              </section>
            </>
          )}

          <footer className="project-edit-footer">
            <Button
              className="project-edit-delete"
              disabled={busy || !projectId}
              tone="danger"
              onClick={onRequestRemove}
            >
              <Trash2 size={APP_ICON_SIZE} />
              删除项目
            </Button>
            <div>
              <Dialog.Close asChild>
                <Button disabled={busy}>取消</Button>
              </Dialog.Close>
              <Button
                disabled={
                  busy || !projectId || !draftName.trim() || !primaryDraft
                }
                loading={busy}
                onClick={() => void save()}
              >
                保存
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function createFolderDraft(project: DesktopWorkspace): DraftFolder[] {
  return (project.folders ?? []).map(folder => ({
    ...folder,
    originalId: folder.id,
  }))
}

function createNewDraftFolder(path: string, order: number): DraftFolder {
  const normalized = path.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/)
  return {
    id: `draft:${crypto.randomUUID()}`,
    name: segments.at(-1) || normalized,
    path,
    role: 'secondary',
    availability: 'available',
    order,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    originalId: null,
  }
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
