import {
  desktopClient,
  type DesktopReviewAgentSummary,
  type DesktopReviewAgentSummaryResult,
} from '../../services/desktop-client/index.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopAuthStatus,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopGitStatusResult,
  DesktopReviewSource,
  DesktopRuntimeStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { upsertRecentWorkspace } from '../settings/settingsStorage.js'
import { normalizePathForComparison } from '../../utils/pathUtils.js'

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

type WorkspaceBranchRef = {
  name: string
  remote: boolean
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

export function mergeWorkspaceGitProjection(
  context: DesktopWorkspace,
  gitStatus: DesktopGitStatus | null,
  branchRefs: readonly WorkspaceBranchRef[],
): DesktopWorkspace {
  const branchName = gitStatus?.branchName ?? null
  const branches = gitStatus
    ? [
        ...new Set([
          ...(branchName ? [branchName] : []),
          ...branchRefs
            .filter(branch => !branch.remote)
            .map(branch => branch.name),
        ]),
      ]
    : []

  return {
    ...context,
    branchName,
    branches,
    // Git status/branches/Review 全部不可用（如非 Git 项目返回
    // REPOSITORY_NOT_FOUND）时必须投影为 isGitRepo=false，不能继承
    // 旧会话的陈旧 Git 标记，否则会把非 Git 项目误判为 Git 项目。
    isGitRepo: gitStatus ? true : false,
  }
}

export function mergeWorkspaceReviewFileStats(
  gitStatus: DesktopGitStatus,
  summaries: readonly (Pick<DesktopReviewAgentSummary, 'files'> | null)[],
): DesktopGitStatus {
  if (summaries.some(summary => summary === null)) return gitStatus

  const statsByPath = new Map<string, { additions: number; deletions: number }>()
  for (const summary of summaries) {
    if (!summary) continue
    for (const file of summary.files) {
      const key = normalizeWorkspacePath(file.path)
      const current = statsByPath.get(key)
      statsByPath.set(key, {
        additions: (current?.additions ?? 0) + (file.additions ?? 0),
        deletions: (current?.deletions ?? 0) + (file.deletions ?? 0),
      })
    }
  }

  return {
    ...gitStatus,
    files: gitStatus.files.map(file => {
      const stats = statsByPath.get(normalizeWorkspacePath(file.path))
      return stats ? { ...file, ...stats } : file
    }),
  }
}

export type WorkspaceGitProjectionLoaders = {
  loadGitStatus: () => Promise<DesktopGitStatusResult>
  loadBranches: () => Promise<readonly WorkspaceBranchRef[]>
  loadReviewSummary: (source: DesktopReviewSource) => Promise<DesktopReviewAgentSummaryResult>
}

export type WorkspaceGitProjectionResult = {
  workspace: DesktopWorkspace
  gitStatus: DesktopGitStatus | null
}

export async function resolveWorkspaceGitProjection(
  context: DesktopWorkspace,
  loaders: WorkspaceGitProjectionLoaders,
): Promise<WorkspaceGitProjectionResult> {
  let gitStatusResult: DesktopGitStatusResult | null = null
  try {
    gitStatusResult = await loaders.loadGitStatus()
  } catch {
    gitStatusResult = null
  }

  // 非 Git 是受支持状态：Git status 返回 ok=false（含 REPOSITORY_NOT_FOUND）
  // 或 reject 时直接投影为空 Git 表面，绝不继续调用 branches/Review RPC，
  // 也无需向全局 onError 上报。
  if (!gitStatusResult?.ok) {
    return {
      workspace: mergeWorkspaceGitProjection(context, null, []),
      gitStatus: null,
    }
  }

  const [branchesResult, unstagedResult, stagedResult] =
    await Promise.allSettled([
      loaders.loadBranches(),
      loaders.loadReviewSummary({ kind: 'unstaged' }),
      loaders.loadReviewSummary({ kind: 'staged' }),
    ])
  const summaries = [unstagedResult, stagedResult].map(result =>
    result.status === 'fulfilled' ? result.value.snapshot : null,
  )
  const nextGitStatus = mergeWorkspaceReviewFileStats(
    gitStatusResult.status,
    summaries,
  )
  const branches =
    branchesResult.status === 'fulfilled' ? branchesResult.value : []
  return {
    workspace: mergeWorkspaceGitProjection(context, nextGitStatus, branches),
    gitStatus: nextGitStatus,
  }
}

type WorkspaceRefreshResult = {
  context: DesktopWorkspace
  files: DesktopFileEntry[]
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
  const appliedWorkspaceIdentityRef = useRef<string | null>(null)
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
        // 项目上下文与文件树是工作区的核心状态；Git/Review 失败不能阻止它们更新。
        const [nextContext, nextFiles] = await Promise.all([
          desktopClient.getWorkspaceContext(target.path, target.projectId),
          desktopClient.listWorkspaceFiles(
            target.path,
            '.',
            target.primaryFolderId,
            target.projectId,
          ),
        ])
        return {
          context: nextContext,
          files: nextFiles,
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
      appliedWorkspaceIdentityRef.current = nextWorkspace
        ? workspaceIdentity(nextWorkspace)
        : null
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
        setGitStatus(null)
        refreshCoordinatorRef.current?.markApplied(result.context)
        if (refreshOptions.clearSelectedFile ?? true) {
          setSelectedFile(null)
        } else {
          await refreshSelectedFilePreview(
            result.context,
            refreshOptions.expectedSessionId ?? activeSessionIdRef.current,
          )
        }
        void refreshWorkspaceGitProjection(result.context)
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

  async function refreshWorkspaceGitProjection(
    target: DesktopWorkspace,
  ): Promise<void> {
    const identity = workspaceIdentity(target)
    const { workspace: projected, gitStatus: nextGitStatus } =
      await resolveWorkspaceGitProjection(target, {
        loadGitStatus: () =>
          desktopClient.getWorkspaceGitStatus(target.path, target.projectId),
        loadBranches: () =>
          desktopClient.getAgentReviewBranches(target.path, target.projectId),
        loadReviewSummary: source =>
          desktopClient.getAgentReviewSummary({
            ...(target.projectId ? { projectId: target.projectId } : {}),
            workspacePath: target.path,
            source,
            refresh: true,
          }),
      })
    if (appliedWorkspaceIdentityRef.current !== identity) return
    setWorkspaceState(projected)
    setGitStatus(nextGitStatus)
    onRecentWorkspacesChangeRef.current(current =>
      upsertRecentWorkspace(current, projected),
    )
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
  return normalizePathForComparison(path)
}
