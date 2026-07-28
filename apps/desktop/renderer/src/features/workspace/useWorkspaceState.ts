import { desktopClient } from '../../services/desktop-client/index.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopAuthStatus,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopRuntimeStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { upsertRecentWorkspace } from '../settings/settingsStorage.js'
import { recordConversationSwitchRequest } from '../debug/performanceDiagnosticsBridge.js'

export const NO_WORKSPACE_DIFF = '未选择项目。'

export type UseWorkspaceStateOptions = {
  onError: (message: string) => void
  onWorkspaceUnavailable?: (workspace: DesktopWorkspace) => void
  onRecentWorkspacesChange: (
    next: DesktopWorkspace[] | ((current: DesktopWorkspace[]) => DesktopWorkspace[]),
  ) => void
}

export type RefreshWorkspaceOptions = {
  clearSelectedFile?: boolean
  expectedSessionId?: string | null
  force?: boolean
}

type WorkspaceRefreshCoordinator<T> = {
  load: (
    target: DesktopWorkspace,
    options?: { force?: boolean },
  ) => Promise<T> | null
  markApplied: (target: DesktopWorkspace) => void
  reset: () => void
}

export function workspaceIdentity(workspace: DesktopWorkspace): string {
  return [
    workspace.projectId ?? '',
    workspace.primaryFolderId ?? '',
    normalizeWorkspacePath(workspace.path),
  ].join(':')
}

export function createWorkspaceRefreshCoordinator<T>(
  loader: (target: DesktopWorkspace) => Promise<T>,
): WorkspaceRefreshCoordinator<T> {
  let appliedIdentity: string | null = null
  const inFlight = new Map<string, Promise<T>>()

  return {
    load(target, options = {}) {
      const identity = workspaceIdentity(target)
      const pending = inFlight.get(identity)
      if (pending) return pending
      if (!options.force && identity === appliedIdentity) return null

      const request = loader(target).finally(() => {
        if (inFlight.get(identity) === request) {
          inFlight.delete(identity)
        }
      })
      inFlight.set(identity, request)
      return request
    },
    markApplied(target) {
      appliedIdentity = workspaceIdentity(target)
    },
    reset() {
      appliedIdentity = null
      inFlight.clear()
    },
  }
}

type WorkspaceRefreshResult = {
  context: DesktopWorkspace
  files: DesktopFileEntry[]
  diff: string
  gitStatus: DesktopGitStatus | null
}

export type UseWorkspaceStateResult = {
  workspace: DesktopWorkspace | null
  authStatus: DesktopAuthStatus | null
  runtimeStatus: DesktopRuntimeStatus | null
  files: DesktopFileEntry[]
  selectedFile: DesktopFilePreview | null
  diff: string
  gitStatus: DesktopGitStatus | null
  setActiveSessionId: (id: string | null) => void
  refreshRuntimeStatus: () => Promise<void>
  refreshWorkspace: (
    target?: DesktopWorkspace | null,
    options?: RefreshWorkspaceOptions,
  ) => Promise<void>
  chooseWorkspace: () => Promise<DesktopWorkspace | null>
  openRecentWorkspace: (target: DesktopWorkspace) => Promise<DesktopWorkspace | null>
  previewFile: (file: DesktopFileEntry) => Promise<void>
  setSelectedFile: (preview: DesktopFilePreview | null) => void
  setWorkspace: (workspace: DesktopWorkspace | null) => void
  setDiff: (diff: string) => void
}

export function useWorkspaceState(
  options: UseWorkspaceStateOptions,
): UseWorkspaceStateResult {
  const [workspace, setWorkspaceState] = useState<DesktopWorkspace | null>(null)
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(
    null,
  )
  const [files, setFiles] = useState<DesktopFileEntry[]>([])
  const [selectedFile, setSelectedFileState] =
    useState<DesktopFilePreview | null>(null)
  const selectedFileRef = useRef<DesktopFilePreview | null>(null)
  const [diff, setDiff] = useState(NO_WORKSPACE_DIFF)
  const [gitStatus, setGitStatus] = useState<DesktopGitStatus | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError
  const onWorkspaceUnavailableRef = useRef(options.onWorkspaceUnavailable)
  onWorkspaceUnavailableRef.current = options.onWorkspaceUnavailable
  const onRecentWorkspacesChangeRef = useRef(options.onRecentWorkspacesChange)
  onRecentWorkspacesChangeRef.current = options.onRecentWorkspacesChange
  const refreshCoordinatorRef =
    useRef<WorkspaceRefreshCoordinator<WorkspaceRefreshResult> | null>(null)
  if (!refreshCoordinatorRef.current) {
    refreshCoordinatorRef.current = createWorkspaceRefreshCoordinator(
      async target => {
        recordConversationSwitchRequest('workspace-refresh')
        const [nextContext, nextFiles, nextDiff, nextGitStatus] =
          await Promise.all([
            desktopClient.getWorkspaceContext(target.path),
            desktopClient.listWorkspaceFiles(
              target.path,
              '.',
              target.primaryFolderId,
              target.projectId,
            ),
            desktopClient.getWorkspaceDiff(target.path),
            desktopClient.getWorkspaceGitStatus(target.path),
          ])
        return {
          context: nextContext,
          files: nextFiles,
          diff: nextDiff.patch,
          gitStatus: nextGitStatus.ok ? nextGitStatus.status : null,
        }
      },
    )
  }

  function setActiveSessionId(id: string | null): void {
    activeSessionIdRef.current = id
  }

  const setSelectedFile = useCallback(
    (preview: DesktopFilePreview | null): void => {
      selectedFileRef.current = preview
      setSelectedFileState(preview)
    },
    [],
  )

  const setWorkspace = useCallback(
    (nextWorkspace: DesktopWorkspace | null): void => {
      setWorkspaceState(nextWorkspace)
      if (!nextWorkspace) {
        refreshCoordinatorRef.current?.reset()
        setGitStatus(null)
      }
    },
    [],
  )

  const refreshRuntimeStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await desktopClient.getRuntimeStatus()
      setRuntimeStatus(status)
    } catch (error) {
      onErrorRef.current(errorMessageOf(error))
    }
  }, [])

  useEffect(() => {
    void desktopClient
      .getAuthStatus()
      .then(status => setAuthStatus(status))
      .catch((error: unknown) => onErrorRef.current(errorMessageOf(error)))
  }, [])

  useEffect(() => {
    let mounted = true
    const refresh = (): void => {
      void refreshRuntimeStatus().finally(() => {
        if (!mounted) return
      })
    }

    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [refreshRuntimeStatus])

  const refreshWorkspace = useCallback(
    async (
      target: DesktopWorkspace | null = workspace,
      refreshOptions: RefreshWorkspaceOptions = {},
    ): Promise<void> => {
      if (!target) return
      if (target.isStandalone) {
        setWorkspace(null)
        setFiles([])
        setDiff(NO_WORKSPACE_DIFF)
        setGitStatus(null)
        setSelectedFile(null)
        return
      }
      try {
        const request = refreshCoordinatorRef.current?.load(target, {
          force: refreshOptions.force,
        })
        if (!request) return
        const result = await request
        if (
          refreshOptions.expectedSessionId !== undefined &&
          refreshOptions.expectedSessionId !== null &&
          refreshOptions.expectedSessionId !== activeSessionIdRef.current
        ) {
          return
        }
        setWorkspace(result.context)
        onRecentWorkspacesChangeRef.current(current =>
          upsertRecentWorkspace(current, result.context),
        )
        setFiles(result.files)
        setDiff(result.diff)
        setGitStatus(result.gitStatus)
        refreshCoordinatorRef.current?.markApplied(result.context)
        if (refreshOptions.clearSelectedFile ?? true) {
          setSelectedFile(null)
        } else {
          await refreshSelectedFilePreview(
            result.context,
            refreshOptions.expectedSessionId ?? activeSessionIdRef.current,
          )
        }
      } catch (error) {
        if (isWorkspaceUnavailableError(error)) {
          onWorkspaceUnavailableRef.current?.(target)
          return
        }
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [setSelectedFile, workspace],
  )

  async function refreshSelectedFilePreview(
    target: DesktopWorkspace,
    targetSessionId: string | null,
  ): Promise<void> {
    if (!targetSessionId || targetSessionId !== activeSessionIdRef.current) {
      return
    }
    const currentSelectedFile = selectedFileRef.current
    if (!currentSelectedFile) return
    try {
      const preview = await desktopClient.readWorkspaceFile(
        target.path,
        currentSelectedFile.path,
        currentSelectedFile.folderId,
        target.projectId,
      )
      setSelectedFile(preview)
    } catch {
      setSelectedFile(null)
    }
  }

  const chooseWorkspace = useCallback(async (): Promise<DesktopWorkspace | null> => {
    try {
      const selected = await desktopClient.chooseWorkspace()
      return selected
    } catch (error) {
      onErrorRef.current(errorMessageOf(error))
      return null
    }
  }, [])

  const openRecentWorkspace = useCallback(
    async (target: DesktopWorkspace): Promise<DesktopWorkspace | null> => {
      try {
        const selected = await desktopClient.openWorkspace(
          target.path,
          target.projectId,
        )
        return selected
      } catch (error) {
        if (isWorkspaceUnavailableError(error)) {
          onWorkspaceUnavailableRef.current?.(target)
          return null
        }
        onErrorRef.current(errorMessageOf(error))
        return null
      }
    },
    [],
  )

  const previewFile = useCallback(
    async (file: DesktopFileEntry): Promise<void> => {
      if (!workspace || file.type !== 'file') return
      try {
        const preview = await desktopClient.readWorkspaceFile(
          file.rootPath ?? workspace.path,
          file.path,
          file.folderId,
          workspace.projectId,
        )
        setSelectedFile(preview)
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [workspace],
  )

  return {
    workspace,
    authStatus,
    runtimeStatus,
    files,
    selectedFile,
    diff,
    gitStatus,
    setActiveSessionId,
    refreshRuntimeStatus,
    refreshWorkspace,
    chooseWorkspace,
    openRecentWorkspace,
    previewFile,
    setSelectedFile,
    setWorkspace,
    setDiff,
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isWorkspaceUnavailableError(error: unknown): boolean {
  const message = errorMessageOf(error)
  return /\b(ENOENT|ENOTDIR|EACCES|EPERM)\b/.test(message)
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
}
