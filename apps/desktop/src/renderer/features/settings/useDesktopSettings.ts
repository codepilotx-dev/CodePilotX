import { desktopClient } from '../../services/desktopClient.js'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { DrawerTab } from '../../uiTypes.js'
import type {
  DesktopDiffMarkerStyle,
  DesktopPermissionMode,
  DesktopPersonality,
  DesktopReviewView,
  DesktopSandboxMode,
  DesktopBrowserSitePermission,
  DesktopThinkingMode,
  DesktopWorkspace,
  ModelProviderID,
  SidebarSectionId,
} from '../../../shared/types.js'
import {
  type StoredDesktopSettings,
  readStoredDesktopSettings,
  storeDesktopSettings,
} from './settingsStorage.js'

export type UseDesktopSettingsResult = {
  enableParetoCodeRouter: boolean
  enableFusionRouter: boolean
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  permissionMode: DesktopPermissionMode
  model: string
  planExecutionModel: string
  reviewModel: string
  smallFastModel: string
  fastModel: string
  defaultModel: string
  deepModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  drawerTab: DrawerTab
  selectedModelPreset: string
  providerID: ModelProviderID
  providerBaseURL: string
  showContextUsage: boolean
  defaultOpenTargetId: string
  gitBranchPrefix: string
  gitPrMergeMethod: 'merge' | 'squash'
  gitShowPrIconsInSidebar: boolean
  gitDraftPullRequest: boolean
  gitAutoDeleteWorktree: boolean
  gitAutoDeleteWorktreeLimit: number
  allowForcePush: boolean
  commitMessagePrompt: string
  pullRequestPrompt: string
  githubOAuthClientId: string
  sandboxMode: DesktopSandboxMode
  allowNetworkAccess: boolean
  installCodePilotXDependencies: boolean
  personality: DesktopPersonality
  customInstructions: string
  enableMemory: boolean
  skipToolAidedChats: boolean
  githubMemorySyncEnabled: boolean
  githubMemoryRepository: string
  reviewView: DesktopReviewView
  diffMarkerStyle: DesktopDiffMarkerStyle
  rustSearchAndDiffKernels: boolean
	  browserAllowedSites: string[]
	  collapsedSidebarSections: SidebarSectionId[]
	  browserSitePermissions: DesktopBrowserSitePermission[]
  settingsLoaded: boolean
  setPermissionMode: (value: DesktopPermissionMode) => void
  setEnableAutoReviewPermissionMode: (value: boolean) => void
  setEnableFullAccessPermissionMode: (value: boolean) => void
  setModel: (value: string) => void
  setPlanExecutionModel: (value: string) => void
  setReviewModel: (value: string) => void
  setSmallFastModel: (value: string) => void
  setFastModel: (value: string) => void
  setDefaultModel: (value: string) => void
  setDeepModel: (value: string) => void
  setSessionName: (value: string) => void
  setThinkingMode: (value: DesktopThinkingMode) => void
  setSystemPrompt: (value: string) => void
  setAppendSystemPrompt: (value: string) => void
  setAdditionalDirectories: (value: string) => void
  setRecentWorkspaces: (
    value: DesktopWorkspace[] | ((current: DesktopWorkspace[]) => DesktopWorkspace[]),
  ) => void
  setDrawerTab: (value: DrawerTab) => void
  setSelectedModelPreset: (value: string) => void
  setProviderID: (value: ModelProviderID) => void
  setProviderBaseURL: (value: string) => void
  setShowContextUsage: (value: boolean) => void
  setDefaultOpenTargetId: (value: string) => void
  setGitBranchPrefix: (value: string) => void
  setGitPrMergeMethod: (value: 'merge' | 'squash') => void
  setGitShowPrIconsInSidebar: (value: boolean) => void
  setGitDraftPullRequest: (value: boolean) => void
  setGitAutoDeleteWorktree: (value: boolean) => void
  setGitAutoDeleteWorktreeLimit: (value: number) => void
  setAllowForcePush: (value: boolean) => void
  setCommitMessagePrompt: (value: string) => void
  setPullRequestPrompt: (value: string) => void
  setGithubOAuthClientId: (value: string) => void
  setSandboxMode: (value: DesktopSandboxMode) => void
  setAllowNetworkAccess: (value: boolean) => void
  setInstallCodexDependencies: (value: boolean) => void
  setPersonality: (value: DesktopPersonality) => void
  setCustomInstructions: (value: string) => void
  setEnableMemory: (value: boolean) => void
  setSkipToolAidedChats: (value: boolean) => void
  setGithubMemorySyncEnabled: (value: boolean) => void
  setGithubMemoryRepository: (value: string) => void
  setReviewView: (value: DesktopReviewView) => void
  setDiffMarkerStyle: (value: DesktopDiffMarkerStyle) => void
  setRustSearchAndDiffKernels: (value: boolean) => void
  setBrowserAllowedSites: (value: string[]) => void
  setCollapsedSidebarSections: (
    value: SidebarSectionId[] | ((current: SidebarSectionId[]) => SidebarSectionId[]),
  ) => void
  syncExternalSettingsPatch: (
    patch: Partial<StoredDesktopSettings>,
  ) => void
  draft: DesktopSettingsDraft
  flushDesktopSettings: () => Promise<void>
}

type DesktopSettingsDraftSetter = <
  Key extends keyof StoredDesktopSettings,
>(
  key: Key,
  value:
    | StoredDesktopSettings[Key]
    | ((current: StoredDesktopSettings[Key]) => StoredDesktopSettings[Key]),
) => void

export type DesktopSettingsDraft = {
  values: StoredDesktopSettings
  dirty: boolean
  saving: boolean
  setValue: DesktopSettingsDraftSetter
  save: (baseValues?: StoredDesktopSettings) => Promise<StoredDesktopSettings>
  reset: () => void
  autoSave: () => void
}

export function isSettingsSaveShortcut(event: {
  ctrlKey: boolean
  metaKey: boolean
  key: string
}): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
}

export function createSettingsSaveShortcutHandler(
  save: () => Promise<unknown>,
): (event: {
  ctrlKey: boolean
  metaKey: boolean
  key: string
  preventDefault: () => void
}) => Promise<boolean> {
  return async event => {
    if (!isSettingsSaveShortcut(event)) return false
    event.preventDefault()
    await save()
    return true
  }
}

export function createDesktopSettingsDraft(
  initialValues: StoredDesktopSettings,
  saveValues: (
    values: StoredDesktopSettings,
  ) => Promise<StoredDesktopSettings | void>,
): DesktopSettingsDraft {
  let values = cloneDesktopSettings(initialValues)
  const dirtyKeys = new Set<keyof StoredDesktopSettings>()
  let dirty = false

  return {
    get values() {
      return values
    },
    get dirty() {
      return dirty
    },
    saving: false,
    setValue(key, value) {
      values = updateDesktopSettingsValue(values, key, value)
      dirtyKeys.add(key)
      dirty = !desktopSettingsEqual(values, initialValues)
    },
    async save(baseValues = initialValues) {
      const snapshot = mergeDesktopSettingsDraft(baseValues, values, dirtyKeys)
      const saved = await saveValues(snapshot)
      values = saved
        ? cloneDesktopSettings(saved)
        : cloneDesktopSettings(snapshot)
      dirtyKeys.clear()
      dirty = false
      return values
    },
    reset() {
      values = cloneDesktopSettings(initialValues)
      dirtyKeys.clear()
      dirty = false
    },
    autoSave() {
      const snapshot = mergeDesktopSettingsDraft(initialValues, values, dirtyKeys)
      void saveValues(snapshot).then(saved => {
        values = saved
          ? cloneDesktopSettings(saved)
          : cloneDesktopSettings(snapshot)
        dirtyKeys.clear()
        dirty = false
      })
    },
  }
}

const DesktopSettingsContext = createContext<UseDesktopSettingsResult | null>(
  null,
)

export function DesktopSettingsProvider({
  children,
}: {
  children: ReactNode
}): ReactNode {
  const settings = useDesktopSettingsState()
  return createElement(
    DesktopSettingsContext.Provider,
    { value: settings },
    children,
  )
}

export function useDesktopSettings(): UseDesktopSettingsResult {
  const settings = useContext(DesktopSettingsContext)
  if (settings) {
    return settings
  }
  return useDesktopSettingsState()
}

  function useDesktopSettingsState(): UseDesktopSettingsResult {
  const initial = readStoredDesktopSettings()
  const [enableParetoCodeRouter, setEnableParetoCodeRouter] = useState<boolean>(
    initial.enableParetoCodeRouter ?? false,
  )
  const [enableFusionRouter, setEnableFusionRouter] = useState<boolean>(
    initial.enableFusionRouter ?? false,
  )
  const [
    enableAutoReviewPermissionMode,
    setEnableAutoReviewPermissionMode,
  ] = useState<boolean>(initial.enableAutoReviewPermissionMode ?? false)
  const [
    enableFullAccessPermissionMode,
    setEnableFullAccessPermissionMode,
  ] = useState<boolean>(initial.enableFullAccessPermissionMode ?? false)
  const [permissionMode, setPermissionMode] = useState<DesktopPermissionMode>(
    initial.permissionMode,
  )
  const [model, setModel] = useState(initial.model)
  const [planExecutionModel, setPlanExecutionModel] = useState(
    initial.planExecutionModel,
  )
  const [reviewModel, setReviewModel] = useState(initial.reviewModel)
  const [smallFastModel, setSmallFastModel] = useState(initial.smallFastModel)
  const [fastModel, setFastModel] = useState(initial.fastModel)
  const [defaultModel, setDefaultModel] = useState(initial.defaultModel)
  const [deepModel, setDeepModel] = useState(initial.deepModel)
  const [sessionName, setSessionName] = useState(initial.sessionName)
  const [thinkingMode, setThinkingMode] = useState<DesktopThinkingMode>(
    initial.thinkingMode,
  )
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt)
  const [appendSystemPrompt, setAppendSystemPrompt] = useState(
    initial.appendSystemPrompt,
  )
  const [additionalDirectories, setAdditionalDirectories] = useState(
    initial.additionalDirectories,
  )
  const [recentWorkspaces, setRecentWorkspaces] = useState<DesktopWorkspace[]>(
    initial.recentWorkspaces,
  )
  const [lastActiveWorkspacePath, setLastActiveWorkspacePath] = useState(
    initial.lastActiveWorkspacePath,
  )
  const [removedWorkspaces, setRemovedWorkspaces] = useState(
    initial.removedWorkspaces,
  )
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(initial.drawerTab)
  const [selectedModelPreset, setSelectedModelPreset] = useState<string>(
    initial.selectedModelPreset,
  )
  const [providerID, setProviderID] = useState<ModelProviderID>(
    initial.providerID,
  )
  const [providerBaseURL, setProviderBaseURL] = useState(
    initial.providerBaseURL,
  )
  const [showContextUsage, setShowContextUsage] = useState(
    initial.showContextUsage,
  )
  const [defaultOpenTargetId, setDefaultOpenTargetId] = useState(
    initial.defaultOpenTargetId,
  )
  const [gitBranchPrefix, setGitBranchPrefix] = useState(
    initial.gitBranchPrefix,
  )
  const [gitPrMergeMethod, setGitPrMergeMethod] = useState<'merge' | 'squash'>(
    initial.gitPrMergeMethod,
  )
  const [gitShowPrIconsInSidebar, setGitShowPrIconsInSidebar] = useState(
    initial.gitShowPrIconsInSidebar,
  )
  const [gitDraftPullRequest, setGitDraftPullRequest] = useState(
    initial.gitDraftPullRequest,
  )
  const [gitAutoDeleteWorktree, setGitAutoDeleteWorktree] = useState(
    initial.gitAutoDeleteWorktree,
  )
  const [gitAutoDeleteWorktreeLimit, setGitAutoDeleteWorktreeLimit] = useState(
    initial.gitAutoDeleteWorktreeLimit,
  )
  const [allowForcePush, setAllowForcePush] = useState(initial.allowForcePush)
  const [commitMessagePrompt, setCommitMessagePrompt] = useState(
    initial.commitMessagePrompt,
  )
  const [pullRequestPrompt, setPullRequestPrompt] = useState(
    initial.pullRequestPrompt,
  )
  const [githubOAuthClientId, setGithubOAuthClientId] = useState(
    initial.githubOAuthClientId,
  )
  const [sandboxMode, setSandboxMode] = useState<DesktopSandboxMode>(
    initial.sandboxMode,
  )
  const [allowNetworkAccess, setAllowNetworkAccess] = useState(
    initial.allowNetworkAccess,
  )
  const [installCodePilotXDependencies, setInstallCodexDependencies] = useState(
    initial.installCodePilotXDependencies,
  )
  const [personality, setPersonality] = useState<DesktopPersonality>(
    initial.personality,
  )
  const [customInstructions, setCustomInstructions] = useState(
    initial.customInstructions,
  )
  const [enableMemory, setEnableMemory] = useState(initial.enableMemory)
  const [skipToolAidedChats, setSkipToolAidedChats] = useState(
    initial.skipToolAidedChats,
  )
  const [githubMemorySyncEnabled, setGithubMemorySyncEnabled] = useState(
    initial.githubMemorySyncEnabled,
  )
  const [githubMemoryRepository, setGithubMemoryRepository] = useState(
    initial.githubMemoryRepository,
  )
  const [reviewView, setReviewView] = useState<DesktopReviewView>(
    initial.reviewView,
  )
  const [diffMarkerStyle, setDiffMarkerStyle] =
    useState<DesktopDiffMarkerStyle>(initial.diffMarkerStyle)
  const [rustSearchAndDiffKernels, setRustSearchAndDiffKernels] = useState(
    initial.rustSearchAndDiffKernels,
  )
  const [browserAllowedSites, setBrowserAllowedSites] = useState<string[]>(
    initial.browserAllowedSites,
  )
  const [collapsedSidebarSections, setCollapsedSidebarSections] = useState<SidebarSectionId[]>(
    initial.collapsedSidebarSections,
  )
  const [browserSitePermissions, setBrowserSitePermissions] = useState<
    DesktopBrowserSitePermission[]
  >(initial.browserSitePermissions)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const skipNextAutoSaveRef = useRef(false)
  const [draftValues, setDraftValues] = useState<StoredDesktopSettings>(
    cloneDesktopSettings(initial),
  )
  const draftValuesRef = useRef(draftValues)
  draftValuesRef.current = draftValues
  const draftDirtyKeysRef = useRef<Set<keyof StoredDesktopSettings>>(new Set())
  const [draftSaving, setDraftSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getDesktopSettings()
      .then(settings => {
        if (!mounted) return
        setEnableParetoCodeRouter(settings.enableParetoCodeRouter ?? false)
        setEnableFusionRouter(settings.enableFusionRouter ?? false)
        setEnableAutoReviewPermissionMode(
          settings.enableAutoReviewPermissionMode ?? false,
        )
        setEnableFullAccessPermissionMode(
          settings.enableFullAccessPermissionMode ?? false,
        )
        setPermissionMode(settings.permissionMode)
        setModel(settings.model)
        setPlanExecutionModel(settings.planExecutionModel)
        setReviewModel(settings.reviewModel)
        setSmallFastModel(settings.smallFastModel)
        setFastModel(settings.fastModel)
        setDefaultModel(settings.defaultModel)
        setDeepModel(settings.deepModel)
        setSessionName(settings.sessionName)
        setThinkingMode(settings.thinkingMode)
        setSystemPrompt(settings.systemPrompt)
        setAppendSystemPrompt(settings.appendSystemPrompt)
        setAdditionalDirectories(settings.additionalDirectories)
        setRecentWorkspaces(settings.recentWorkspaces)
        setLastActiveWorkspacePath(settings.lastActiveWorkspacePath)
        setRemovedWorkspaces(settings.removedWorkspaces)
        setDrawerTab(settings.drawerTab)
        setSelectedModelPreset(settings.selectedModelPreset)
        setProviderID(settings.providerID)
        setProviderBaseURL(settings.providerBaseURL)
        setShowContextUsage(settings.showContextUsage)
        setDefaultOpenTargetId(settings.defaultOpenTargetId)
        setGitBranchPrefix(settings.gitBranchPrefix)
        setGitPrMergeMethod(settings.gitPrMergeMethod)
        setGitShowPrIconsInSidebar(settings.gitShowPrIconsInSidebar)
        setGitDraftPullRequest(settings.gitDraftPullRequest)
        setGitAutoDeleteWorktree(settings.gitAutoDeleteWorktree)
        setGitAutoDeleteWorktreeLimit(settings.gitAutoDeleteWorktreeLimit)
        setAllowForcePush(settings.allowForcePush)
        setCommitMessagePrompt(settings.commitMessagePrompt)
        setPullRequestPrompt(settings.pullRequestPrompt)
        setGithubOAuthClientId(settings.githubOAuthClientId)
        setSandboxMode(settings.sandboxMode)
        setAllowNetworkAccess(settings.allowNetworkAccess)
        setInstallCodexDependencies(settings.installCodePilotXDependencies)
        setPersonality(settings.personality)
        setCustomInstructions(settings.customInstructions)
        setEnableMemory(settings.enableMemory)
        setSkipToolAidedChats(settings.skipToolAidedChats)
        setGithubMemorySyncEnabled(settings.githubMemorySyncEnabled)
        setGithubMemoryRepository(settings.githubMemoryRepository)
        setReviewView(settings.reviewView)
        setDiffMarkerStyle(settings.diffMarkerStyle)
        setRustSearchAndDiffKernels(settings.rustSearchAndDiffKernels)
        setBrowserAllowedSites(settings.browserAllowedSites)
        setBrowserSitePermissions(settings.browserSitePermissions)
        setDraftValues(cloneDesktopSettings(settings))
        draftDirtyKeysRef.current.clear()
        setSettingsLoaded(true)
      })
      .catch(() => {
        if (mounted) {
          setSettingsLoaded(true)
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  const effectiveSettings = useMemo<StoredDesktopSettings>(
    () => ({
      enableParetoCodeRouter,
      enableFusionRouter,
      enableAutoReviewPermissionMode,
      enableFullAccessPermissionMode,
      permissionMode,
      model,
      planExecutionModel,
      reviewModel,
      smallFastModel,
      fastModel,
      defaultModel,
      deepModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      recentWorkspaces,
      lastActiveWorkspacePath,
      removedWorkspaces,
      drawerTab,
      selectedModelPreset,
      providerID,
      providerBaseURL,
      showContextUsage,
      defaultOpenTargetId,
      gitBranchPrefix,
      gitPrMergeMethod,
      gitShowPrIconsInSidebar,
      gitDraftPullRequest,
      gitAutoDeleteWorktree,
      gitAutoDeleteWorktreeLimit,
      allowForcePush,
      commitMessagePrompt,
      pullRequestPrompt,
      githubOAuthClientId,
      sandboxMode,
      allowNetworkAccess,
      installCodePilotXDependencies,
      personality,
      customInstructions,
      enableMemory,
      skipToolAidedChats,
      githubMemorySyncEnabled,
      githubMemoryRepository,
      reviewView,
      diffMarkerStyle,
	      rustSearchAndDiffKernels,
	      browserAllowedSites,
	      collapsedSidebarSections,
	      browserSitePermissions,
	    }),
	    [
	      enableParetoCodeRouter,
      enableFusionRouter,
      enableAutoReviewPermissionMode,
      enableFullAccessPermissionMode,
      permissionMode,
      model,
      planExecutionModel,
      reviewModel,
      smallFastModel,
      fastModel,
      defaultModel,
      deepModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      recentWorkspaces,
      lastActiveWorkspacePath,
      removedWorkspaces,
      drawerTab,
      selectedModelPreset,
      providerID,
      providerBaseURL,
      showContextUsage,
      defaultOpenTargetId,
      gitBranchPrefix,
      gitPrMergeMethod,
      gitShowPrIconsInSidebar,
      gitDraftPullRequest,
      gitAutoDeleteWorktree,
      gitAutoDeleteWorktreeLimit,
      allowForcePush,
      commitMessagePrompt,
      pullRequestPrompt,
      githubOAuthClientId,
      sandboxMode,
      allowNetworkAccess,
      installCodePilotXDependencies,
      personality,
      customInstructions,
      enableMemory,
      skipToolAidedChats,
      githubMemorySyncEnabled,
      githubMemoryRepository,
      reviewView,
      diffMarkerStyle,
	      rustSearchAndDiffKernels,
	      browserAllowedSites,
	      collapsedSidebarSections,
	      browserSitePermissions,
	    ],
  )
  const effectiveSettingsRef = useRef(effectiveSettings)
  effectiveSettingsRef.current = effectiveSettings

  const draftDirty = useMemo(
    () => !desktopSettingsEqual(draftValues, effectiveSettings),
    [draftValues, effectiveSettings],
  )

  useEffect(() => {
    if (!settingsLoaded) return
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false
      return
    }
    storeDesktopSettings(effectiveSettings)
  }, [effectiveSettings, settingsLoaded])

  useEffect(() => {
    if (!settingsLoaded || draftDirty) return
    setDraftValues(cloneDesktopSettings(effectiveSettings))
    draftDirtyKeysRef.current.clear()
  }, [draftDirty, effectiveSettings, settingsLoaded])

  const flushDesktopSettings = useCallback(async (): Promise<void> => {
    try {
      await desktopClient.saveDesktopSettings(effectiveSettings)
    } catch {
      // Persistence is best-effort; the next state change will retry.
    }
  }, [effectiveSettings])

  const setDraftValue = useCallback<DesktopSettingsDraftSetter>(
    (key, value) => {
      draftDirtyKeysRef.current.add(key)
      setDraftValues(current => updateDesktopSettingsValue(current, key, value))
    },
    [],
  )

  const applySettingsSnapshot = useCallback(
    (snapshot: StoredDesktopSettings): void => {
      setEnableParetoCodeRouter(snapshot.enableParetoCodeRouter ?? false)
      setEnableFusionRouter(snapshot.enableFusionRouter ?? false)
      setEnableAutoReviewPermissionMode(
        snapshot.enableAutoReviewPermissionMode ?? false,
      )
      setEnableFullAccessPermissionMode(
        snapshot.enableFullAccessPermissionMode ?? false,
      )
      setPermissionMode(snapshot.permissionMode)
      setModel(snapshot.model)
      setPlanExecutionModel(snapshot.planExecutionModel)
      setReviewModel(snapshot.reviewModel)
      setSmallFastModel(snapshot.smallFastModel)
      setFastModel(snapshot.fastModel)
      setDefaultModel(snapshot.defaultModel)
      setDeepModel(snapshot.deepModel)
      setSessionName(snapshot.sessionName)
      setThinkingMode(snapshot.thinkingMode)
      setSystemPrompt(snapshot.systemPrompt)
      setAppendSystemPrompt(snapshot.appendSystemPrompt)
      setAdditionalDirectories(snapshot.additionalDirectories)
      setRecentWorkspaces(snapshot.recentWorkspaces)
      setLastActiveWorkspacePath(snapshot.lastActiveWorkspacePath)
      setRemovedWorkspaces(snapshot.removedWorkspaces)
      setDrawerTab(snapshot.drawerTab)
      setSelectedModelPreset(snapshot.selectedModelPreset)
      setProviderID(snapshot.providerID)
      setProviderBaseURL(snapshot.providerBaseURL)
      setShowContextUsage(snapshot.showContextUsage)
      setDefaultOpenTargetId(snapshot.defaultOpenTargetId)
      setGitBranchPrefix(snapshot.gitBranchPrefix)
      setGitPrMergeMethod(snapshot.gitPrMergeMethod)
      setGitShowPrIconsInSidebar(snapshot.gitShowPrIconsInSidebar)
      setGitDraftPullRequest(snapshot.gitDraftPullRequest)
      setGitAutoDeleteWorktree(snapshot.gitAutoDeleteWorktree)
      setGitAutoDeleteWorktreeLimit(snapshot.gitAutoDeleteWorktreeLimit)
      setAllowForcePush(snapshot.allowForcePush)
      setCommitMessagePrompt(snapshot.commitMessagePrompt)
      setPullRequestPrompt(snapshot.pullRequestPrompt)
      setGithubOAuthClientId(snapshot.githubOAuthClientId)
      setSandboxMode(snapshot.sandboxMode)
      setAllowNetworkAccess(snapshot.allowNetworkAccess)
      setInstallCodexDependencies(snapshot.installCodePilotXDependencies)
      setPersonality(snapshot.personality)
      setCustomInstructions(snapshot.customInstructions)
      setEnableMemory(snapshot.enableMemory)
      setSkipToolAidedChats(snapshot.skipToolAidedChats)
      setGithubMemorySyncEnabled(snapshot.githubMemorySyncEnabled)
      setGithubMemoryRepository(snapshot.githubMemoryRepository)
      setReviewView(snapshot.reviewView)
      setDiffMarkerStyle(snapshot.diffMarkerStyle)
        setRustSearchAndDiffKernels(snapshot.rustSearchAndDiffKernels)
	        setBrowserAllowedSites(snapshot.browserAllowedSites)
	        setCollapsedSidebarSections(snapshot.collapsedSidebarSections)
	        setBrowserSitePermissions(snapshot.browserSitePermissions)
      },
    [],
  )

  const syncExternalSettingsPatch = useCallback(
    (patch: Partial<StoredDesktopSettings>): void => {
      const next = mergeExternalDesktopSettingsPatch(
        effectiveSettingsRef.current,
        draftValuesRef.current,
        patch,
      )
      const patchKeys = Object.keys(patch) as Array<keyof StoredDesktopSettings>
      for (const key of patchKeys) {
        draftDirtyKeysRef.current.delete(key)
      }
      if (!next.settingsChanged && !next.draftChanged) {
        return
      }
      if (next.settingsChanged) {
        skipNextAutoSaveRef.current = true
        applySettingsSnapshot(next.settings)
      }
      if (next.draftChanged) {
        setDraftValues(next.draftValues)
      }
    },
    [applySettingsSnapshot],
  )

  useEffect(() => {
    return desktopClient.onDesktopSettingsChange(change => {
      syncExternalSettingsPatch(change.settings)
    })
  }, [syncExternalSettingsPatch])

  const saveDraft = useCallback(async (): Promise<StoredDesktopSettings> => {
    const snapshot = mergeDesktopSettingsDraft(
      effectiveSettings,
      draftValuesRef.current,
      draftDirtyKeysRef.current,
    )
    setDraftSaving(true)
    try {
      const saved = await desktopClient.saveDesktopSettings(snapshot)
      const next = cloneDesktopSettings(saved)
      skipNextAutoSaveRef.current = true
      applySettingsSnapshot(next)
      setDraftValues(next)
      draftDirtyKeysRef.current.clear()
      return next
    } finally {
      setDraftSaving(false)
    }
  }, [applySettingsSnapshot, effectiveSettings])

  const resetDraft = useCallback((): void => {
    setDraftValues(cloneDesktopSettings(effectiveSettings))
    draftDirtyKeysRef.current.clear()
  }, [effectiveSettings])

  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  const autoSave = useCallback(() => {
    setTimeout(() => { void saveDraftRef.current(); }, 0)
  }, [])

  const draft = useMemo<DesktopSettingsDraft>(
    () => ({
      values: draftValues,
      dirty: draftDirty,
      saving: draftSaving,
      setValue: setDraftValue,
      save: saveDraft,
      reset: resetDraft,
      autoSave,
    }),
    [
      draftDirty,
      draftSaving,
      draftValues,
      resetDraft,
      saveDraft,
      setDraftValue,
      autoSave,
    ],
  )

  return {
    enableParetoCodeRouter,
    enableFusionRouter,
    enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode,
    permissionMode,
    model,
    planExecutionModel,
    reviewModel,
    smallFastModel,
    fastModel,
    defaultModel,
    deepModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    recentWorkspaces,
    drawerTab,
    selectedModelPreset,
    providerID,
    providerBaseURL,
    showContextUsage,
defaultOpenTargetId,
    gitBranchPrefix,
    gitPrMergeMethod,
    gitShowPrIconsInSidebar,
    gitDraftPullRequest,
    gitAutoDeleteWorktree,
    gitAutoDeleteWorktreeLimit,
    allowForcePush,
    commitMessagePrompt,
    pullRequestPrompt,
    githubOAuthClientId,
    sandboxMode,
    allowNetworkAccess,
    installCodePilotXDependencies,
    personality,
    customInstructions,
    enableMemory,
    skipToolAidedChats,
      githubMemorySyncEnabled,
      githubMemoryRepository,
      reviewView,
      diffMarkerStyle,
    rustSearchAndDiffKernels,
	    browserAllowedSites,
	    collapsedSidebarSections,
	    browserSitePermissions,
    settingsLoaded,
    setPermissionMode,
    setEnableAutoReviewPermissionMode,
    setEnableFullAccessPermissionMode,
    setModel,
    setPlanExecutionModel,
    setReviewModel,
    setSmallFastModel,
    setFastModel,
    setDefaultModel,
    setDeepModel,
    setSessionName,
    setThinkingMode,
    setSystemPrompt,
    setAppendSystemPrompt,
    setAdditionalDirectories,
    setRecentWorkspaces,
    setDrawerTab,
    setSelectedModelPreset,
    setProviderID,
    setProviderBaseURL,
    setShowContextUsage,
    setDefaultOpenTargetId,
    setGitBranchPrefix,
    setGitPrMergeMethod,
    setGitShowPrIconsInSidebar,
    setGitDraftPullRequest,
    setGitAutoDeleteWorktree,
    setGitAutoDeleteWorktreeLimit,
    setAllowForcePush,
    setCommitMessagePrompt,
    setPullRequestPrompt,
    setGithubOAuthClientId,
    setSandboxMode,
    setAllowNetworkAccess,
    setInstallCodexDependencies,
    setPersonality,
    setCustomInstructions,
    setEnableMemory,
    setSkipToolAidedChats,
    setGithubMemorySyncEnabled,
setGithubMemoryRepository,
    setReviewView,
    setDiffMarkerStyle,
    setRustSearchAndDiffKernels,
	    setBrowserAllowedSites,
	    setCollapsedSidebarSections,
	    syncExternalSettingsPatch,
    draft,
    flushDesktopSettings,
  }
}

function cloneDesktopSettings(
  settings: StoredDesktopSettings,
): StoredDesktopSettings {
  return {
    ...settings,
    recentWorkspaces: settings.recentWorkspaces.map(workspace => ({
      ...workspace,
    })),
    removedWorkspaces: settings.removedWorkspaces.map(workspace => ({
      ...workspace,
    })),
    browserAllowedSites: [...settings.browserAllowedSites],
    collapsedSidebarSections: [...settings.collapsedSidebarSections],
    browserSitePermissions: settings.browserSitePermissions.map(permission => ({
      ...permission,
    })),
  }
}

function updateDesktopSettingsValue<Key extends keyof StoredDesktopSettings>(
  current: StoredDesktopSettings,
  key: Key,
  value:
    | StoredDesktopSettings[Key]
    | ((currentValue: StoredDesktopSettings[Key]) => StoredDesktopSettings[Key]),
): StoredDesktopSettings {
  const currentValue = current[key]
  const nextValue =
    typeof value === 'function'
      ? (value as (
          currentValue: StoredDesktopSettings[Key],
        ) => StoredDesktopSettings[Key])(currentValue)
      : value
  return cloneDesktopSettings({
    ...current,
    [key]: nextValue,
  })
}

export function mergeExternalDesktopSettingsPatch(
  currentSettings: StoredDesktopSettings,
  currentDraftValues: StoredDesktopSettings,
  patch: Partial<StoredDesktopSettings>,
): {
  settings: StoredDesktopSettings
  draftValues: StoredDesktopSettings
  settingsChanged: boolean
  draftChanged: boolean
} {
  const settings = cloneDesktopSettings({
    ...currentSettings,
    ...patch,
  })
  const draftValues = cloneDesktopSettings({
    ...currentDraftValues,
    ...patch,
  })
  return {
    settings,
    draftValues,
    settingsChanged: !desktopSettingsEqual(settings, currentSettings),
    draftChanged: !desktopSettingsEqual(draftValues, currentDraftValues),
  }
}

function mergeDesktopSettingsDraft(
  baseValues: StoredDesktopSettings,
  draftValues: StoredDesktopSettings,
  dirtyKeys: ReadonlySet<keyof StoredDesktopSettings>,
): StoredDesktopSettings {
  const next = cloneDesktopSettings(baseValues)
  for (const key of dirtyKeys) {
    ;(next as Record<keyof StoredDesktopSettings, unknown>)[key] =
      cloneDesktopSettingsValue(draftValues[key])
  }
  return next
}

function cloneDesktopSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item =>
      item && typeof item === 'object' ? { ...item } : item,
    )
  }
  return value
}

function desktopSettingsEqual(
  left: StoredDesktopSettings,
  right: StoredDesktopSettings,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
