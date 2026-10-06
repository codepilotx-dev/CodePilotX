import * as Dialog from '@radix-ui/react-dialog'
import { Folder, FolderPlus, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type {
  DesktopProjectFolder,
  DesktopWorkspace,
  ProjectAppearance,
} from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { useDialogFocusRestore } from '../../components/ui/useDialogFocusRestore.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { cx } from '../../utils/cx.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { ProjectAppearancePicker } from './ProjectAppearancePicker.js'
import { createProjectFolderSavePlan, type ProjectFolderSaveDraft } from './projectEditModel.js'
import { notifyProjectCatalogChanged } from './projectCatalogEvents.js'
import { errorMessageOf as errorMessage } from '@codepilotx/shared/errors'

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
  const [draftFolders, setDraftFolders] = useState<DraftFolder[]>(() => createFolderDraft(project))
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const projectId = project.projectId
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

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
      .then((sources) => {
        const counts: Record<string, number> = {}
        for (const source of sources) {
          if (source.storage !== 'workspace-file') continue
          counts[source.folderId] = (counts[source.folderId] ?? 0) + 1
        }
        setSourceCounts(counts)
      })
      .catch((error) => onReport(errorMessage(error)))
  }, [open, projectId, onReport])

  const primaryDraft = useMemo(
    () => draftFolders.find((folder) => folder.role === 'primary') ?? null,
    [draftFolders],
  )

  async function addFolder(): Promise<void> {
    const path = await desktopClient.chooseProjectFolder()
    if (!path) return
    if (draftFolders.some((folder) => samePath(folder.path, path))) {
      onReport('该目录已经在项目中。')
      return
    }
    setDraftFolders((current) => [...current, createNewDraftFolder(path, current.length)])
  }

  async function reselectFolder(folder: DraftFolder): Promise<void> {
    const path = await desktopClient.chooseProjectFolder()
    if (!path) return
    if (
      draftFolders.some((candidate) => candidate.id !== folder.id && samePath(candidate.path, path))
    ) {
      onReport('该目录已经在项目中。')
      return
    }
    const affectedSources = folder.originalId ? (sourceCounts[folder.originalId] ?? 0) : 0
    if (
      affectedSources > 0 &&
      !window.confirm(`重新选择目录会移除原目录下的 ${affectedSources} 个路径来源，是否继续？`)
    ) {
      return
    }
    setDraftFolders((current) =>
      current.map((candidate) =>
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
    setDraftFolders((current) =>
      current.map((folder) => ({
        ...folder,
        role: folder.id === folderId ? 'primary' : 'secondary',
      })),
    )
  }

  function removeFolder(folder: DraftFolder): void {
    if (folder.role === 'primary') return
    const affectedSources = folder.originalId ? (sourceCounts[folder.originalId] ?? 0) : 0
    if (
      affectedSources > 0 &&
      !window.confirm(`移除此目录会同时移除 ${affectedSources} 个路径来源，是否继续？`)
    ) {
      return
    }
    setDraftFolders((current) => current.filter((candidate) => candidate.id !== folder.id))
  }

  async function refreshProject(): Promise<void> {
    if (!projectId) return
    const refreshed = (await desktopClient.listProjects()).find(
      (item) => item.projectId === projectId,
    )
    if (refreshed) onProjectChange(refreshed)
  }

  async function save(): Promise<void> {
    if (!projectId || busy || !draftName.trim() || !primaryDraft) return
    setBusy(true)
    let current = project
    try {
      const savePlan = createProjectFolderSavePlan(project.folders ?? [], draftFolders)
      for (const path of savePlan.addPaths) {
        current = await desktopClient.addProjectFolder(projectId, path)
      }

      const desiredPrimary = current.folders?.find((folder) =>
        samePath(folder.path, savePlan.desiredPrimaryPath),
      )
      if (!desiredPrimary) {
        throw new Error('保存后未找到选定的主目录。')
      }
      if (current.primaryFolderId !== desiredPrimary.id) {
        current = await desktopClient.setPrimaryProjectFolder(projectId, desiredPrimary.id)
      }

      for (const folderId of savePlan.removeFolderIds) {
        const existing = current.folders?.find((folder) => folder.id === folderId)
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
      onReport(`部分项目更改可能已经生效，已刷新实际状态。${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop project-edit-backdrop tw:backdrop-blur-none" />
        <Dialog.Content
          aria-describedby={undefined}
          className="ui-dialog-surface ui-dialog-surface--centered project-edit-dialog tw:flex tw:flex-col tw:box-border tw:w-[min(32rem,calc(100vw-2rem))] tw:max-w-[calc(100vw-2rem)] tw:max-h-[calc(100vh-2rem)] tw:overflow-y-auto tw:gap-3 tw:p-5 tw:text-app-text tw:outline-none"
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const initialFocus = nameInputRef.current ?? closeButtonRef.current
            initialFocus?.focus()
            if (initialFocus === nameInputRef.current) {
              nameInputRef.current?.select()
            }
          }}
        >
          <header className="project-edit-header tw:flex tw:items-center tw:justify-between tw:gap-4">
            <Dialog.Title className="tw:m-0 tw:type-title-lg tw:text-app-text">编辑项目</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton
                className="project-edit-close"
                color="ghostSecondary"
                disabled={busy}
                ref={closeButtonRef}
                size="toolbar"
                title="关闭编辑项目"
              >
                <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </IconButton>
            </Dialog.Close>
          </header>

          {!projectId ? (
            <p className="project-edit-empty tw:m-0 tw:type-body tw:text-app-text-meta">
              当前任务尚未关联稳定项目。
            </p>
          ) : (
            <>
              <div className="project-edit-name-field tw:flex tw:h-10 tw:min-h-10 tw:items-center tw:overflow-hidden tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-canvas tw:focus-within:border-app-border-strong tw:focus-within:shadow-[var(--cpx-sys-focus-ring-inset)]">
                <ProjectAppearancePicker
                  appearance={draftAppearance}
                  disabled={busy}
                  glyphSize={APP_ICON_SIZE}
                  onChange={(nextAppearance) => {
                    setDraftAppearance(nextAppearance)
                    onAppearanceChange(nextAppearance)
                  }}
                />
                <input
                  aria-label="项目名称"
                  className="project-edit-name-input tw:min-w-0 tw:flex-1 tw:h-full tw:border-0 tw:bg-transparent tw:px-1 tw:py-0 tw:text-app-text tw:type-body tw:outline-none"
                  maxLength={120}
                  ref={nameInputRef}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void save()
                  }}
                />
              </div>

              <section className="project-edit-folders tw:flex tw:flex-col tw:gap-2">
                <h3 className="tw:m-0 tw:type-row-title tw:text-app-text">源文件夹</h3>
                <div className="project-edit-folder-list tw:max-h-[15rem] tw:overflow-y-auto tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-canvas">
                  {draftFolders.map((folder) => (
                    <div
                      className={cx(
                        'project-edit-folder-row tw:box-border tw:flex tw:h-12 tw:min-h-12 tw:w-full tw:items-center tw:gap-3 tw:border-0 tw:border-b tw:border-app-border-subtle tw:bg-transparent tw:px-3 tw:text-start',
                        folder.availability === 'missing'
                          ? 'is-missing tw:text-app-text-meta'
                          : 'tw:text-app-text',
                      )}
                      key={folder.id}
                    >
                      <Folder size={APP_ICON_SIZE} />
                      <span
                        className="project-edit-folder-name tw:min-w-0 tw:flex-1 tw:truncate tw:px-1 tw:type-body"
                        title={folder.path}
                      >
                        {folder.name}
                      </span>
                      {draftFolders.length > 1 && folder.role === 'primary' ? (
                        <span className="project-edit-primary-badge tw:shrink-0 tw:rounded-full tw:bg-app-hover tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-soft">
                          主目录
                        </span>
                      ) : null}
                      {draftFolders.length > 1 && folder.role !== 'primary' ? (
                        <IconButton
                          className="project-edit-folder-action tw:w-[1.875rem]"
                          color="ghostSecondary"
                          disabled={busy}
                          size="toolbar"
                          title={`将 ${folder.name} 设为主目录`}
                          type="button"
                          onClick={() => setPrimary(folder.id)}
                        >
                          <Star size={APP_ICON_SIZE} />
                        </IconButton>
                      ) : null}
                      {folder.availability === 'missing' ? (
                        <IconButton
                          className="project-edit-folder-action tw:w-[1.875rem]"
                          color="ghostSecondary"
                          disabled={busy}
                          size="toolbar"
                          title={`重新选择目录 ${folder.name}`}
                          type="button"
                          onClick={() => void reselectFolder(folder)}
                        >
                          <RefreshCw size={APP_ICON_SIZE} />
                        </IconButton>
                      ) : null}
                      <IconButton
                        className="project-edit-folder-action tw:w-[1.875rem]"
                        color="ghostSecondary"
                        disabled={busy || folder.role === 'primary'}
                        size="toolbar"
                        title={`移除目录 ${folder.name}`}
                        type="button"
                        onClick={() => removeFolder(folder)}
                      >
                        <X size={APP_ICON_SIZE} />
                      </IconButton>
                    </div>
                  ))}
                  <button
                    className="project-edit-add-folder tw:box-border tw:flex tw:h-12 tw:min-h-12 tw:w-full tw:cursor-pointer tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:px-3 tw:text-start tw:text-app-text-soft tw:type-body tw:enabled:hover:bg-app-hover tw:enabled:hover:text-app-text"
                    disabled={busy}
                    type="button"
                    onClick={() => void addFolder()}
                  >
                    <FolderPlus size={APP_ICON_SIZE} />
                    <span className="tw:px-1">添加文件夹</span>
                  </button>
                </div>
              </section>
            </>
          )}

          <footer className="project-edit-footer tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
            <Button
              className="project-edit-delete tw:me-auto"
              color="danger"
              disabled={busy || !projectId}
              size="medium"
              onClick={onRequestRemove}
            >
              <Trash2 size={APP_ICON_SIZE} />
              删除项目
            </Button>
            <div className="project-edit-footer-actions tw:flex tw:items-center tw:gap-3">
              <Dialog.Close asChild>
                <Button color="secondary" disabled={busy} size="medium">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                color="primary"
                disabled={busy || !projectId || !draftName.trim() || !primaryDraft}
                loading={busy}
                size="medium"
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
  return (project.folders ?? []).map((folder) => ({
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
