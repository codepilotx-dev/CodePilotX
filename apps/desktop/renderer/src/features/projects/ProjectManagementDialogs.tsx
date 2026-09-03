import type React from 'react'
import { lazy, Suspense, useState } from 'react'
import type { DesktopWorkspace } from '../../../shared/types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useEverOpened } from '../../hooks/usePresenceRetention.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import { DEFAULT_PROJECT_APPEARANCE } from './projectAppearance.js'
import { notifyProjectCatalogChanged } from './projectCatalogEvents.js'

const ProjectEditDialog = lazy(async () => {
  const module = await import('./ProjectEditDialog.js')
  return { default: module.ProjectEditDialog }
})

const ConfirmationDialog = lazy(async () => {
  const module = await import('../../components/ui/ConfirmationDialog.js')
  return { default: module.ConfirmationDialog }
})

type Props = {
  project: DesktopWorkspace
  managerOpen: boolean
  confirmRemoveOpen: boolean
  busy?: boolean
  setManagerOpen: (open: boolean) => void
  setConfirmRemoveOpen: (open: boolean) => void
  onProjectChange: (project: DesktopWorkspace) => void
  onArchiveSessions: () => Promise<boolean>
  onRemoveWorkspace: (project: DesktopWorkspace) => void
  onReport: (message: string) => void
}

export function ProjectManagementDialogs({ project, managerOpen, confirmRemoveOpen,
  busy = false, setManagerOpen, setConfirmRemoveOpen, onProjectChange,
  onArchiveSessions, onRemoveWorkspace, onReport,
}: Props): React.ReactNode {
  const confirmationDialogMounted = useEverOpened(confirmRemoveOpen)
  const managerDialogMounted = useEverOpened(managerOpen)
  const [processingAction, setProcessingAction] = useState<'remove' | null>(null)
  const { projectAppearances, setProjectAppearances } = useDesktopSettings()
  const appearance = project.projectId
    ? projectAppearances[project.projectId] ?? DEFAULT_PROJECT_APPEARANCE
    : DEFAULT_PROJECT_APPEARANCE
  return (
    <>
      {confirmationDialogMounted ? (
        <Suspense fallback={null}>
          <ConfirmationDialog
            actionDisabled={busy || processingAction !== null}
            actionLabel={processingAction === 'remove' ? '处理中…' : '移除'}
            description="项目任务将一并归档。磁盘上的目录与文件不会被删除。"
            open={confirmRemoveOpen}
            title={`移除 ${project.name}?`}
            tone="danger"
            onAction={() => {
              if (busy || processingAction) return
              setProcessingAction('remove')
              void (project.projectId
                ? desktopClient
                    .removeProject(project.projectId)
                    .then(() => true)
                : onArchiveSessions()
              )
                .then(success => {
                  if (!success) return
                  setConfirmRemoveOpen(false)
                  if (project.projectId) {
                    setProjectAppearances(current => {
                      const {
                        [project.projectId as string]: _removed,
                        ...next
                      } = current
                      return next
                    })
                  }
                  onRemoveWorkspace(project)
                  notifyProjectCatalogChanged()
                })
                .catch(error => onReport(
                  error instanceof Error ? error.message : String(error),
                ))
                .finally(() => setProcessingAction(null))
            }}
            onCancel={() => setConfirmRemoveOpen(false)}
          />
        </Suspense>
      ) : null}

      {managerDialogMounted ? (
        <Suspense fallback={null}>
          <ProjectEditDialog
            appearance={appearance}
            open={managerOpen}
            project={project}
            onAppearanceChange={nextAppearance => {
              if (!project.projectId) return
              setProjectAppearances(current => ({
                ...current,
                [project.projectId as string]: nextAppearance,
              }))
            }}
            onOpenChange={setManagerOpen}
            onProjectChange={onProjectChange}
            onReport={onReport}
            onRequestRemove={() => {
              setManagerOpen(false)
              setConfirmRemoveOpen(true)
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}
