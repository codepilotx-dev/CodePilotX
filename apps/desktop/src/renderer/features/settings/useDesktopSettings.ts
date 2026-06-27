import { desktopClient } from '../../services/desktopClient.js'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
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
  flushDesktopSettings: () => Promise<void>
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

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getDesktopSettings()
      .then(settings => {
        if (!mounted) return
        setPermissionMode(settings.permissionMode)
        setModel(settings.model)
        setFallbackModel(settings.fallbackModel)
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

  useEffect(() => {
    if (!settingsLoaded) return
    const next: StoredDesktopSettings = {
      permissionMode,
      model,
      fallbackModel: '',
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
    }
    storeDesktopSettings(next)
  }, [
    settingsLoaded,
    permissionMode,
    model,
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
  ])

  const flushDesktopSettings = useCallback(async (): Promise<void> => {
    const snapshot: StoredDesktopSettings = {
      permissionMode,
      model,
      fallbackModel: '',
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
    }
    try {
      await desktopClient.saveDesktopSettings(snapshot)
    } catch {
      // Persistence is best-effort; the next state change will retry.
    }
  }, [
    permissionMode,
    model,
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
  ])

  return {
    permissionMode,
    model,
    fallbackModel,
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
    flushDesktopSettings,
  }
}
