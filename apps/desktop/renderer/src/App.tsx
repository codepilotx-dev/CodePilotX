import type { ModelRef, PermissionMode, ProvidersResponse, SendStrategy, SessionSnapshot, TaskMode } from '@codepilotx/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agentApi, subscribeToSession, type ProjectInfo, type ProjectSettings, type Proposal } from './api/agent-client'
import { Composer } from './components/Composer'
import { ConversationTimeline } from './components/ConversationTimeline'
import { DesktopShell } from './components/DesktopShell'
import { ProviderSettings } from './components/ProviderSettings'
import { ProjectSettingsPanel } from './components/ProjectSettings'
import { WorkflowPanel, type WorkflowStage } from './components/WorkflowPanel'
import { applyServerEvent, initialViewPreferences, projectConversation, type ViewPreferences } from './domain/task-flow'

const PROJECT_KEY = 'codepilotx.activeProjectID'

export default function App() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [projectID, setProjectID] = useState<string | null>(null)
  const [projectSettings, setProjectSettings] = useState<ProjectSettings | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [projectBusy, setProjectBusy] = useState(false)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [providers, setProviders] = useState<ProvidersResponse | null>(null)
  const [model, setModel] = useState<ModelRef | null>(null)
  const permissionMode: PermissionMode = 'ask'
  const [strategy, setStrategy] = useState<SendStrategy>('queue')
  const [taskMode, setTaskMode] = useState<TaskMode>('chat')
  const [preferences, setPreferences] = useState<ViewPreferences>(initialViewPreferences)
  const [now, setNow] = useState(Date.now())
  const [agentConnection, setAgentConnection] = useState<'connected' | 'disconnected' | 'unknown'>('unknown')
  const [streamConnection, setStreamConnection] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const lastEventID = useRef(0)

  useEffect(() => {
    const desktop = window.codePilotXDesktop
    if (!desktop) return
    void desktop.getAgentConnectionState().then(setAgentConnection).catch(() => undefined)
    return desktop.onAgentConnectionChange(setAgentConnection)
  }, [])

  const loadProviders = useCallback(async () => {
    const data = await agentApi.providers()
    setProviders(data)
    setModel((current) => current ?? data.defaultModel ?? firstConfiguredModel(data))
    return data
  }, [])

  const loadProjectSettings = useCallback(async (nextProjectID: string, providerData: ProvidersResponse | null) => {
    const settings = await agentApi.projectSettings(nextProjectID)
    setProjectSettings(settings)
    setModel(resolveProjectModel(settings, providerData))
  }, [])

  const createProjectSession = useCallback(async (nextProjectID: string) => {
    lastEventID.current = 0
    setSnapshot(null)
    setProposals([])
    const next = await agentApi.createSession('CodePilotX 对话', nextProjectID)
    localStorage.setItem(`${PROJECT_KEY}.session.${nextProjectID}`, next.session.id)
    setSnapshot(next)
  }, [])

  const selectProject = useCallback(async (nextProjectID: string, providerData: ProvidersResponse | null) => {
    setProjectBusy(true)
    setError(null)
    try {
      setProjectID(nextProjectID)
      localStorage.setItem(PROJECT_KEY, nextProjectID)
      const selected = await agentApi.selectProject(nextProjectID)
      setProjects((current) => current.map((project) => project.id === selected.id ? selected : project))
      await loadProjectSettings(nextProjectID, providerData)
      const savedID = localStorage.getItem(`${PROJECT_KEY}.session.${nextProjectID}`)
      if (savedID) {
        try { lastEventID.current = 0; setSnapshot(await agentApi.getSession(savedID)); setProposals(await agentApi.proposals(savedID)) }
        catch { await createProjectSession(nextProjectID) }
      } else await createProjectSession(nextProjectID)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加载项目')
    } finally { setProjectBusy(false) }
  }, [createProjectSession, loadProjectSettings])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [nextProjects, nextProviders] = await Promise.all([agentApi.projects(), loadProviders()])
        if (cancelled) return
        setProjects(nextProjects)
        const savedProjectID = localStorage.getItem(PROJECT_KEY)
        const initialProject = nextProjects.find((project) => project.id === savedProjectID) ?? nextProjects[0]
        if (initialProject) await selectProject(initialProject.id, nextProviders)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '无法连接 CodePilotX Agent')
      }
    })()
    return () => { cancelled = true }
  }, [loadProviders, selectProject])

  useEffect(() => {
    if (!snapshot) { setStreamConnection('idle'); return }
    let opened = false
    setStreamConnection('connecting')
    return subscribeToSession(snapshot.session.id, lastEventID.current, (envelope) => {
      lastEventID.current = Math.max(lastEventID.current, envelope.id)
      setSnapshot((current) => current ? applyServerEvent(current, envelope) : current)
      if ((envelope as unknown as { event?: { type?: string } }).event?.type === 'session.snapshot') {
        void agentApi.proposals(snapshot.session.id).then(setProposals).catch(() => undefined)
      }
    }, (isConnected) => {
      setStreamConnection(isConnected ? 'connected' : opened ? 'reconnecting' : 'connecting')
      if (isConnected && opened) {
        void Promise.all([agentApi.getSession(snapshot.session.id), agentApi.proposals(snapshot.session.id)]).then(([next, nextProposals]) => {
          setSnapshot(next)
          setProposals(nextProposals)
        }).catch(() => undefined)
      }
      if (isConnected) opened = true
    })
  }, [snapshot?.session.id])

  const proposalVersion = snapshot?.runs.map((run) => `${run.id}:${run.status}`).join('|')
  useEffect(() => {
    if (!snapshot) return
    void agentApi.proposals(snapshot.session.id).then(setProposals).catch(() => undefined)
  }, [snapshot?.session.id, proposalVersion])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  const conversation = useMemo(
    () => snapshot ? projectConversation(snapshot, preferences, now) : { messages: [], tasks: [], queuedMessages: [] },
    [snapshot, preferences, now],
  )
  const activeRun = snapshot ? [...snapshot.runs].reverse().find((run) => ['running', 'waiting-permission', 'waiting-question', 'waiting-plan-confirmation'].includes(String(run.status))) : undefined
  const activeTask = activeRun ? conversation.tasks.find((task) => task.id === activeRun.id) : null
  const workflowStages = useMemo(() => buildWorkflowStages(activeRun, activeTask?.phase, Boolean(activeTask?.plan), proposals.some((proposal) => proposal.runID === activeRun?.id)), [activeRun, activeTask?.phase, activeTask?.plan, proposals])

  const refreshSession = useCallback(async () => {
    if (!snapshot) return
    setSnapshot(await agentApi.getSession(snapshot.session.id))
  }, [snapshot])

  const openProject = useCallback(async () => {
    const rootPath = await window.codePilotXDesktop?.pickWorkspaceDirectory()
    if (!rootPath) return
    setProjectBusy(true)
    setError(null)
    try {
      const project = await agentApi.createProject({ rootPath })
      const nextProjects = await agentApi.projects()
      setProjects(nextProjects)
      await selectProject(project.id, providers)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开项目目录')
    } finally { setProjectBusy(false) }
  }, [providers, selectProject])

  const newConversation = useCallback(async () => {
    if (!projectID) return
    setProjectBusy(true)
    try { await createProjectSession(projectID) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建对话') }
    finally { setProjectBusy(false) }
  }, [createProjectSession, projectID])

  const submit = useCallback(async (content: string, mode = taskMode) => {
    if (!snapshot || !model) return
    setError(null)
    try {
      await agentApi.submitMessage(snapshot.session.id, { content, model, permissionMode, strategy, taskMode: mode })
      await refreshSession()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '消息提交失败') }
  }, [snapshot, model, permissionMode, strategy, taskMode, refreshSession])

  const togglePreference = (field: 'processExpanded' | 'planExpanded' | 'filesExpanded', taskID: string) => {
    setPreferences((current) => ({ ...current, [field]: { ...current[field], [taskID]: !(current[field][taskID] ?? (field === 'processExpanded')) } }))
  }

  const saveProjectSettings = useCallback(async (next: ProjectSettings) => {
    if (!projectID) return
    setSettingsBusy(true)
    try {
      const saved = await agentApi.saveProjectSettings(projectID, next)
      setProjectSettings(saved)
      setModel(saved.defaultModel ?? providers?.defaultModel ?? (providers ? firstConfiguredModel(providers) : null))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '项目设置保存失败') }
    finally { setSettingsBusy(false) }
  }, [projectID, providers])

  return (
    <DesktopShell
      agentConnection={agentConnection}
      streamConnection={streamConnection}
      projects={projects}
      activeProjectID={projectID}
      busy={projectBusy}
      onOpenProject={() => { void openProject() }}
      onSelectProject={(id) => { void selectProject(id, providers) }}
      onNewConversation={() => { void newConversation() }}
      onOpenSettings={() => setSettingsOpen(true)}
      composer={
        <Composer
          phase={activeTask?.phase ?? 'idle'}
          taskMode={taskMode}
          strategy={strategy}
          model={model}
          providers={providers?.providers ?? []}
          disabled={!snapshot || !projectID || projectBusy}
          onTaskModeChange={setTaskMode}
          onStrategyChange={setStrategy}
          onModelChange={setModel}
          onSend={submit}
          onStop={async () => { if (snapshot) { await agentApi.stop(snapshot.session.id); await refreshSession() } }}
        />
      }
    >
      {settingsOpen ? (
        <div className="settings-stack">
          <ProjectSettingsPanel settings={projectSettings} providers={providers?.providers ?? []} busy={settingsBusy} onSave={(next) => { void saveProjectSettings(next) }} />
          <ProviderSettings
          data={providers}
          busy={settingsBusy}
          onClose={() => setSettingsOpen(false)}
          onRefresh={async () => { setSettingsBusy(true); try { setProviders(await agentApi.refreshModels()) } finally { setSettingsBusy(false) } }}
          onSaveCredential={async (providerID, apiKey) => { await agentApi.saveCredential(providerID, apiKey); await loadProviders() }}
          onDeleteCredential={async (providerID) => { await agentApi.deleteCredential(providerID); await loadProviders() }}
          onSetDefaultModel={async (nextModel) => { await agentApi.setDefaultModel(nextModel); await loadProviders(); setModel(nextModel) }}
          onSetReviewerModel={async (nextModel) => { await agentApi.setReviewerModel(nextModel); await loadProviders() }}
          onSaveProvider={async (setting) => { await agentApi.saveProvider(setting); await loadProviders() }}
          />
        </div>
      ) : (
        <>
          {error ? <div className="connection-error" role="alert">{error}</div> : null}
          {projectID ? <WorkflowPanel proposals={proposals} stages={workflowStages} busy={proposalBusy} onReview={(id, status) => { void (async () => { setProposalBusy(true); try { const saved = await agentApi.reviewProposal(id, status); setProposals((current) => current.map((proposal) => proposal.id === saved.id ? saved : proposal)) } catch (cause) { setError(cause instanceof Error ? cause.message : '提议状态更新失败') } finally { setProposalBusy(false) } })() }} /> : <section className="project-onboarding"><FolderPrompt onOpen={openProject} /></section>}
          <ConversationTimeline
            {...conversation}
            onToggleProcess={(id) => togglePreference('processExpanded', id)}
            onTogglePlan={(id) => togglePreference('planExpanded', id)}
            onToggleEditedFiles={(id) => togglePreference('filesExpanded', id)}
            onUndoEditResult={(id) => setPreferences((current) => ({ ...current, editActions: { ...current.editActions, [id]: 'undone' } }))}
            onSubmitEditReview={(id) => setPreferences((current) => ({ ...current, editActions: { ...current.editActions, [id]: 'reviewed' } }))}
            onQuestionAnswer={async (_taskID, questionID, answer, ignored) => {
              await agentApi.replyQuestion(questionID, answer, ignored)
              await refreshSession()
            }}
            onGenerateProposals={(taskID) => {
              if (!snapshot) return
              void (async () => {
                try {
                  await agentApi.planDecision(taskID, 'continue')
                  setPreferences((current) => ({ ...current, planActions: { ...current.planActions, [taskID]: 'proposals-generated' } }))
                  await refreshSession()
                } catch (cause) { setError(cause instanceof Error ? cause.message : '无法确认计划') }
              })()
            }}
            onKeepPlan={(taskID) => {
              void (async () => {
                try {
                  await agentApi.planDecision(taskID, 'reject')
                  setPreferences((current) => ({ ...current, planActions: { ...current.planActions, [taskID]: 'kept' } }))
                  await refreshSession()
                } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保留计划') }
              })()
            }}
          />
        </>
      )}
    </DesktopShell>
  )
}

function FolderPrompt({ onOpen }: { onOpen: () => Promise<void> }) {
  return <div className="project-empty-state"><h1>先选择一个项目</h1><p>CodePilotX 只会读取你选择的目录，并将所有修改和命令显示为可审阅的提议。</p><button onClick={() => { void onOpen() }}>打开项目目录</button></div>
}

function firstConfiguredModel(data: ProvidersResponse): ModelRef | null {
  const provider = data.providers.find((candidate) => candidate.configured && candidate.models.length > 0)
  return provider ? { providerID: provider.id, modelID: provider.models[0].id } : null
}

export function resolveProjectModel(settings: ProjectSettings, providerData: ProvidersResponse | null): ModelRef | null {
  return settings.defaultModel ?? providerData?.defaultModel ?? (providerData ? firstConfiguredModel(providerData) : null)
}

function buildWorkflowStages(activeRun: SessionSnapshot['runs'][number] | undefined, phase: string | undefined, hasPlan: boolean, hasProposals: boolean): WorkflowStage[] {
  const activeRunID = activeRun?.id
  const terminal = phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : phase === 'interrupted' || phase === 'stopped' ? 'interrupted' : undefined
  const stored = new Map((activeRun?.stages ?? []).map((stage) => [stage.role, stage]))
  const statusFor = (role: WorkflowStage['role']): WorkflowStage['status'] | undefined => {
    const status = stored.get(role)?.status
    return status === 'waiting-question' ? 'running' : status
  }
  const planner: WorkflowStage = { role: 'planner', status: hasPlan ? 'completed' : terminal ?? (activeRunID ? 'running' : 'pending'), detail: hasPlan ? '正式计划已生成' : undefined }
  const developer: WorkflowStage = { role: 'developer', status: statusFor('developer') ?? (hasProposals ? 'completed' : terminal && hasPlan ? terminal : hasPlan && activeRunID ? 'running' : 'pending'), detail: hasProposals ? '修改提议已生成' : undefined }
  const reviewer: WorkflowStage = { role: 'reviewer', status: statusFor('reviewer') ?? (terminal && hasProposals ? terminal : hasProposals && activeRunID ? 'running' : phase === 'completed' && hasProposals ? 'completed' : 'pending'), detail: phase === 'waiting-plan-confirmation' ? '等待计划确认' : undefined }
  planner.status = statusFor('planner') ?? planner.status
  return [planner, developer, reviewer]
}
