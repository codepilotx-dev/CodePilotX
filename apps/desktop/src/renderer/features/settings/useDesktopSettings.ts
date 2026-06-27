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
  DesktopAskUserQuestionMaxQuestions,
  DesktopPermissionMode,
  DesktopPersonality,
  DesktopReviewView,
  DesktopSandboxMode,
  DesktopThinkingMode,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../shared/types.js'
import {
  type StoredDesktopSettings,
  readStoredDesktopSettings,
  storeDesktopSettings,
} from './settingsStorage.js'

export type UseDesktopSettingsResult = {
  permissionMode: DesktopPermissionMode
  model: string
  fallbackModel: string
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
  installCodexDependencies: boolean
  personality: DesktopPersonality
  customInstructions: string
  enableMemory: boolean
  skipToolAidedChats: boolean
  githubMemorySyncEnabled: boolean
  githubMemoryRepository: string
  reviewView: DesktopReviewView
  askUserQuestionMaxQuestions: DesktopAskUserQuestionMaxQuestions
  rustSearchAndDiffKernels: boolean
  browserAllowedSites: string[]
  settingsLoaded: boolean
  setPermissionMode: (value: DesktopPermissionMode) => void
  setModel: (value: string) => void
  setFallbackModel: (value: string) => void
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
  setAskUserQuestionMaxQuestions: (
    value: DesktopAskUserQuestionMaxQuestions,
  ) => void
  setRustSearchAndDiffKernels: (value: boolean) => void
  setBrowserAllowedSites: (value: string[]) => void
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
  const [permissionMode, setPermissionMode] = useState<DesktopPermissionMode>(
    initial.permissionMode,
  )
  const [model, setModel] = useState(initial.model)
  const [fallbackModel, setFallbackModel] = useState(initial.fallbackModel)
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
  const [installCodexDependencies, setInstallCodexDependencies] = useState(
    initial.installCodexDependencies,
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
  const [
    askUserQuestionMaxQuestions,
    setAskUserQuestionMaxQuestions,
  ] = useState<DesktopAskUserQuestionMaxQuestions>(
    initial.askUserQuestionMaxQuestions,
  )
  const [rustSearchAndDiffKernels, setRustSearchAndDiffKernels] = useState(
    initial.rustSearchAndDiffKernels,
  )
  const [browserAllowedSites, setBrowserAllowedSites] = useState<string[]>(
    initial.browserAllowedSites,
  )
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const skipNextAutoSaveRef = useRef(false)
  const [draftValues, setDraftValues] = useState<StoredDesktopSettings>(
    cloneDesktopSettings(initial),
  )
  const draftDirtyKeysRef = useRef<Set<keyof StoredDesktopSettings>>(new Set())
  const [draftSaving, setDraftSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getDesktopSettings()
      .then(settings => {
        if (!mounted) return
        setPermissionMode(settings.permissionMode)
        setModel(settings.model)
        setFallbackModel(settings.fallbackModel)
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
        setInstallCodexDependencies(settings.installCodexDependencies)
        setPersonality(settings.personality)
        setCustomInstructions(settings.customInstructions)
        setEnableMemory(settings.enableMemory)
        setSkipToolAidedChats(settings.skipToolAidedChats)
        setGithubMemorySyncEnabled(settings.githubMemorySyncEnabled)
        setGithubMemoryRepository(settings.githubMemoryRepository)
        setReviewView(settings.reviewView)
        setAskUserQuestionMaxQuestions(settings.askUserQuestionMaxQuestions)
        setRustSearchAndDiffKernels(settings.rustSearchAndDiffKernels)
        setBrowserAllowedSites(settings.browserAllowedSites)
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
      permissionMode,
      model,
      fallbackModel: '',
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
      installCodexDependencies,
      personality,
      customInstructions,
      enableMemory,
      skipToolAidedChats,
      githubMemorySyncEnabled,
      githubMemoryRepository,
      reviewView,
      askUserQuestionMaxQuestions,
      rustSearchAndDiffKernels,
      browserAllowedSites,
    }),
    [
      permissionMode,
      model,
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
      installCodexDependencies,
      personality,
      customInstructions,
      enableMemory,
      skipToolAidedChats,
      githubMemorySyncEnabled,
      githubMemoryRepository,
      reviewView,
      askUserQuestionMaxQuestions,
      rustSearchAndDiffKernels,
      browserAllowedSites,
    ],
  )

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
      setPermissionMode(snapshot.permissionMode)
      setModel(snapshot.model)
      setFallbackModel(snapshot.fallbackModel)
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
      setInstallCodexDependencies(snapshot.installCodexDependencies)
      setPersonality(snapshot.personality)
      setCustomInstructions(snapshot.customInstructions)
      setEnableMemory(snapshot.enableMemory)
      setSkipToolAidedChats(snapshot.skipToolAidedChats)
      setGithubMemorySyncEnabled(snapshot.githubMemorySyncEnabled)
      setGithubMemoryRepository(snapshot.githubMemoryRepository)
      setReviewView(snapshot.reviewView)
      setAskUserQuestionMaxQuestions(snapshot.askUserQuestionMaxQuestions)
      setRustSearchAndDiffKernels(snapshot.rustSearchAndDiffKernels)
      setBrowserAllowedSites(snapshot.browserAllowedSites)
    },
    [],
  )

  const saveDraft = useCallback(async (): Promise<StoredDesktopSettings> => {
    const snapshot = mergeDesktopSettingsDraft(
      effectiveSettings,
      draftValues,
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
  }, [applySettingsSnapshot, draftValues, effectiveSettings])

  const resetDraft = useCallback((): void => {
    setDraftValues(cloneDesktopSettings(effectiveSettings))
    draftDirtyKeysRef.current.clear()
  }, [effectiveSettings])

  const draft = useMemo<DesktopSettingsDraft>(
    () => ({
      values: draftValues,
      dirty: draftDirty,
      saving: draftSaving,
      setValue: setDraftValue,
      save: saveDraft,
      reset: resetDraft,
    }),
    [
      draftDirty,
      draftSaving,
      draftValues,
      resetDraft,
      saveDraft,
      setDraftValue,
    ],
  )

  return {
    permissionMode,
    model,
    fallbackModel,
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
    installCodexDependencies,
    personality,
    customInstructions,
    enableMemory,
    skipToolAidedChats,
    githubMemorySyncEnabled,
    githubMemoryRepository,
    reviewView,
    askUserQuestionMaxQuestions,
    rustSearchAndDiffKernels,
    browserAllowedSites,
    settingsLoaded,
    setPermissionMode,
    setModel,
    setFallbackModel,
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
    setAskUserQuestionMaxQuestions,
    setRustSearchAndDiffKernels,
    setBrowserAllowedSites,
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
    browserAllowedSites: [...settings.browserAllowedSites],
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
