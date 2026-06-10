import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopAuthStatus,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopRuntimeStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { upsertRecentWorkspace } from '../settings/settingsStorage.js'

export const NO_WORKSPACE_DIFF = '未选择项目。'

export type UseWorkspaceStateOptions = {
  onError: (message: string) => void
  onRecentWorkspacesChange: (
    next: DesktopWorkspace[] | ((current: DesktopWorkspace[]) => DesktopWorkspace[]),
  ) => void
}

export type RefreshWorkspaceOptions = {
  clearSelectedFile?: boolean
  expectedSessionId?: string | null
}

export type UseWorkspaceStateResult = {
  workspace: DesktopWorkspace | null
  authStatus: DesktopAuthStatus | null
  runtimeStatus: DesktopRuntimeStatus | null
  files: DesktopFileEntry[]
  selectedFile: DesktopFilePreview | null
  diff: string
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
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null)
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(
    null,
  )
  const [files, setFiles] = useState<DesktopFileEntry[]>([])
  const [selectedFile, setSelectedFileState] =
    useState<DesktopFilePreview | null>(null)
  const selectedFileRef = useRef<DesktopFilePreview | null>(null)
  const [diff, setDiff] = useState(NO_WORKSPACE_DIFF)
  const activeSessionIdRef = useRef<string | null>(null)
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError
  const onRecentWorkspacesChangeRef = useRef(options.onRecentWorkspacesChange)
  onRecentWorkspacesChangeRef.current = options.onRecentWorkspacesChange

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

  const refreshRuntimeStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.desktopApi.getRuntimeStatus()
      setRuntimeStatus(status)
    } catch (error) {
      onErrorRef.current(errorMessageOf(error))
    }
  }, [])

  useEffect(() => {
    void window.desktopApi
      .getAuthStatus()
      .then(status => setAuthStatus(status))
      .catch((error: unknown) => onErrorRef.current(errorMessageOf(error)))
  }, [])

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
        setSelectedFile(null)
        return
      }
      try {
        const [nextContext, nextFiles, nextDiff] = await Promise.all([
          window.desktopApi.getWorkspaceContext(target.path),
          window.desktopApi.listWorkspaceFiles(target.path),
          window.desktopApi.getWorkspaceDiff(target.path),
        ])
        if (
          refreshOptions.expectedSessionId !== undefined &&
          refreshOptions.expectedSessionId !== null &&
          refreshOptions.expectedSessionId !== activeSessionIdRef.current
        ) {
          return
        }
        setWorkspace(nextContext)
        onRecentWorkspacesChangeRef.current(current =>
          upsertRecentWorkspace(current, nextContext),
        )
        setFiles(nextFiles)
        setDiff(nextDiff.patch)
        if (refreshOptions.clearSelectedFile ?? true) {
          setSelectedFile(null)
        } else {
          await refreshSelectedFilePreview(
            nextContext,
            nextFiles,
            refreshOptions.expectedSessionId ?? activeSessionIdRef.current,
          )
        }
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [setSelectedFile, workspace],
  )

  async function refreshSelectedFilePreview(
    target: DesktopWorkspace,
    nextFiles: DesktopFileEntry[],
    targetSessionId: string | null,
  ): Promise<void> {
    if (!targetSessionId || targetSessionId !== activeSessionIdRef.current) {
      return
    }
    const currentSelectedFile = selectedFileRef.current
    if (!currentSelectedFile) return
    const stillExists = nextFiles.some(
      file => file.type === 'file' && file.path === currentSelectedFile.path,
    )
    if (!stillExists) {
      setSelectedFile(null)
      return
    }
    try {
      const preview = await window.desktopApi.readWorkspaceFile(
        target.path,
        currentSelectedFile.path,
      )
      setSelectedFile(preview)
    } catch {
      setSelectedFile(null)
    }
  }

  const chooseWorkspace = useCallback(async (): Promise<DesktopWorkspace | null> => {
    try {
      const selected = await window.desktopApi.chooseWorkspace()
      return selected
    } catch (error) {
      onErrorRef.current(errorMessageOf(error))
      return null
    }
  }, [])

  const openRecentWorkspace = useCallback(
    async (target: DesktopWorkspace): Promise<DesktopWorkspace | null> => {
      try {
        const selected = await window.desktopApi.openWorkspace(target.path)
        return selected
      } catch (error) {
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
        const preview = await window.desktopApi.readWorkspaceFile(
          workspace.path,
          file.path,
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
