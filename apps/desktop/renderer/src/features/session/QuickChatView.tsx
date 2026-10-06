import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import type { DesktopWorkspace } from '../../../shared/types.js'
import {
  getEffectiveReducedMotion,
  usePrefersReducedMotion,
} from '../../hooks/usePrefersReducedMotion.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import {
  createNewSessionSuggestionState,
  removeGeneratedSuggestionStarter,
  selectNewSessionSuggestionCategory,
  showContextualNewSessionSuggestions,
  showNewSessionSuggestionTemplates,
  syncNewSessionSuggestionState,
} from './newSessionSuggestionState.js'
import type {
  NewSessionSuggestionCategory,
  NewSessionSuggestionTask,
  NewSessionTaskSuggestion,
} from './newSessionSuggestions.js'
import { normalizeNewSessionSurfaceSearch, parseNewSessionSurface } from './newSessionSurface.js'
import { DesktopComposer } from './composer/DesktopComposer.js'
import { useQuickChatContext } from './QuickChatContext.js'
import { useContextualTaskSuggestions } from './useContextualTaskSuggestions.js'
import { enterTween, exitTween, motionTransition } from '../motion/motionTransitions.js'
import { WorkingNewSessionView } from './WorkingNewSessionView.js'
import { ChatNewSessionView } from './ChatNewSessionView.js'
import { CodingHeadingTransition } from './CodingHeadingTransition.js'
import { NewSessionSuggestions } from './NewSessionSuggestionPanel.js'
import { ProjectSwitcherPopover } from './composer/ProjectSwitcherPopover.js'
import { useLocale } from '../i18n/LocaleProvider.js'

export function QuickChatView(): React.ReactNode {
  const [searchParams, setSearchParams] = useSearchParams()
  const { sidebarProductMode, setSidebarProductMode } = useDesktopSettings()
  const search = searchParams.toString()
  const urlSurface = parseNewSessionSurface(search)
  const surface = urlSurface ?? sidebarProductMode
  const reducedMotion = usePrefersReducedMotion()

  // 缺失或无效的 surface 参数回退到已保存模式，并只替换 surface 参数
  useEffect(() => {
    if (urlSurface === surface) return
    setSearchParams(normalizeNewSessionSurfaceSearch(search, surface), { replace: true })
  }, [search, setSearchParams, surface, urlSurface])

  // URL 中的有效 surface 优先于已保存设置，并同步侧栏模式
  useEffect(() => {
    if (urlSurface === null || urlSurface === sidebarProductMode) return
    setSidebarProductMode(urlSurface)
  }, [setSidebarProductMode, sidebarProductMode, urlSurface])

  return (
    <AnimatePresence initial={false} mode="wait">
      <NewSessionPresence key={surface} kind="surface" reducedMotion={reducedMotion}>
        {surface === 'working' ? (
          <WorkingNewSessionView />
        ) : surface === 'chat' ? (
          <ChatNewSessionView />
        ) : (
          <CodingQuickChatView />
        )}
      </NewSessionPresence>
    </AnimatePresence>
  )
}

function CodingQuickChatView(): React.ReactNode {
  const { t } = useLocale()
  const reducedMotion = usePrefersReducedMotion()
  const {
    branchName,
    composerProps,
    composerDraft,
    gitStatus,
    recentTasks,
    recentWorkspaces,
    workspaceName,
    workspacePath,
    onAppendComposerText,
    onChooseWorkspace,
    onCloneGithub,
    onClearWorkspace,
    onOpenWorkspace,
  } = useQuickChatContext()
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [observedComposerValue, setObservedComposerValue] = useState(composerDraft?.value ?? '')
  const [suggestionState, setSuggestionState] = useState(() =>
    createNewSessionSuggestionState(composerDraft?.value ?? ''),
  )
  const pageRef = useRef<HTMLDivElement | null>(null)
  const whaleMarkRef = useRef<HTMLButtonElement | null>(null)
  const whaleMarkAnimationRef = useRef<Animation | null>(null)
  const programmaticValueRef = useRef<string | null>(null)
  const currentWorkspace = useMemo<DesktopWorkspace | null>(() => {
    if (!workspaceName || !workspacePath) return null
    return (
      recentWorkspaces.find((workspace) => workspace.path === workspacePath) ?? {
        name: workspaceName,
        path: workspacePath,
        branchName,
      }
    )
  }, [branchName, recentWorkspaces, workspaceName, workspacePath])
  const { suggestions, markInteracted } = useContextualTaskSuggestions({
    active: suggestionState.kind === 'root' && observedComposerValue.trim().length === 0,
    workspaceName,
    workspacePath,
    branchName,
    gitStatus,
    recentTasks,
  })

  const composerDraftValue = composerDraft?.value

  useEffect(() => {
    if (composerDraftValue === undefined) return
    setObservedComposerValue(composerDraftValue)
    if (programmaticValueRef.current === composerDraftValue) {
      programmaticValueRef.current = null
      return
    }
    setSuggestionState((current) => syncNewSessionSuggestionState(current, composerDraftValue))
  }, [composerDraftValue])

  const focusComposer = useCallback(() => {
    if (composerDraft?.focus) {
      composerDraft.focus()
      return
    }
    const editor = pageRef.current?.querySelector<HTMLElement>("textarea, [contenteditable='true']")
    editor?.focus()
  }, [composerDraft])

  const replaceComposerValue = useCallback(
    (value: string) => {
      programmaticValueRef.current = value
      setObservedComposerValue(value)
      if (composerDraft) {
        composerDraft.replace(value)
      } else if (observedComposerValue.length === 0) {
        onAppendComposerText(value)
      }
      requestAnimationFrame(focusComposer)
    },
    [composerDraft, focusComposer, observedComposerValue, onAppendComposerText],
  )

  const handleSelectCategory = useCallback(
    (category: NewSessionSuggestionCategory) => {
      markInteracted()
      setSuggestionState(selectNewSessionSuggestionCategory(category.id))
      replaceComposerValue(category.starter)
    },
    [markInteracted, replaceComposerValue],
  )

  const handleSelectSuggestion = useCallback(
    (suggestion: NewSessionTaskSuggestion) => {
      markInteracted()
      setSuggestionState({ kind: 'hidden', reason: 'custom-input' })
      replaceComposerValue(suggestion.prompt)
    },
    [markInteracted, replaceComposerValue],
  )

  const handleSelectTask = useCallback(
    (category: NewSessionSuggestionCategory, task: NewSessionSuggestionTask) => {
      markInteracted()
      if (!composerDraft && observedComposerValue === category.starter) {
        const completion = task.prompt.startsWith(category.starter)
          ? task.prompt.slice(category.starter.length)
          : task.prompt
        programmaticValueRef.current = task.prompt
        setObservedComposerValue(task.prompt)
        onAppendComposerText(completion)
        requestAnimationFrame(focusComposer)
        return
      }
      replaceComposerValue(task.prompt)
    },
    [
      composerDraft,
      focusComposer,
      markInteracted,
      observedComposerValue,
      onAppendComposerText,
      replaceComposerValue,
    ],
  )

  const handleShowAll = useCallback(
    (category: NewSessionSuggestionCategory) => {
      markInteracted()
      const nextValue = removeGeneratedSuggestionStarter(observedComposerValue, category.starter)
      setSuggestionState(showNewSessionSuggestionTemplates())
      if (nextValue !== observedComposerValue) replaceComposerValue(nextValue)
    },
    [markInteracted, observedComposerValue, replaceComposerValue],
  )

  const handleShowSuggestions = useCallback(() => {
    markInteracted()
    setSuggestionState(showContextualNewSessionSuggestions())
  }, [markInteracted])

  const handleComposerInputCapture = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      const target = event.target
      let value: string | null = null
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        value = target.value
      } else if (target instanceof HTMLElement && target.isContentEditable) {
        value = target.textContent ?? ''
      }
      if (value === null) return
      markInteracted()
      programmaticValueRef.current = null
      setObservedComposerValue(value)
      setSuggestionState((current) => syncNewSessionSuggestionState(current, value))
    },
    [markInteracted],
  )

  const handleWhaleMarkClick = useCallback(() => {
    const mark = whaleMarkRef.current
    if (!mark || getEffectiveReducedMotion()) return
    whaleMarkAnimationRef.current?.cancel()
    whaleMarkAnimationRef.current = mark.animate(
      [
        { transform: 'scale(1) rotate(0deg)' },
        { transform: 'scale(1.08) rotate(180deg)', offset: 0.5 },
        { transform: 'scale(1) rotate(360deg)' },
      ],
      {
        duration: 100,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    )
  }, [])

  useEffect(
    () => () => {
      whaleMarkAnimationRef.current?.cancel()
    },
    [],
  )

  const hasGitWorkspace = Boolean(branchName || gitStatus)
  const headingUsesProject = Boolean(currentWorkspace && workspaceName)
  const headingKey = headingUsesProject
    ? `${hasGitWorkspace ? 'git' : 'project'}:${workspacePath}`
    : 'no-project'
  const headingContent = headingUsesProject ? (
    <>
      {t(hasGitWorkspace ? '要在 ' : '我们应该在 ')}
      <ProjectSwitcherPopover
        align="center"
        className="popover-project quick-chat-project-popover"
        maxWidth="min(420px, calc(100vw - 48px))"
        open={projectMenuOpen}
        recentWorkspaces={recentWorkspaces}
        side="top"
        sideOffset={4}
        trigger={
          <button
            aria-label={`${t('选择项目：')}${workspaceName}`}
            className="project-name tw:inline-block tw:max-w-[min(40vw,18ch)] tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-ellipsis tw:align-baseline tw:cursor-pointer tw:text-app-text tw:[font:inherit] tw:underline tw:decoration-dotted tw:decoration-1 tw:underline-offset-4 tw:hover:text-app-text-soft tw:hover:decoration-current tw:data-[state=open]:text-app-text-soft tw:data-[state=open]:decoration-current tw:aria-expanded:text-app-text-soft tw:aria-expanded:decoration-current tw:focus-visible:outline-offset-3"
            title={workspaceName}
            type="button"
          >
            {workspaceName}
          </button>
        }
        width={200}
        workspace={currentWorkspace}
        onChooseWorkspace={() => {
          void onChooseWorkspace()
          setProjectMenuOpen(false)
        }}
        onCloneGithub={() => {
          onCloneGithub()
          setProjectMenuOpen(false)
        }}
        onClearWorkspace={() => {
          onClearWorkspace()
          setProjectMenuOpen(false)
        }}
        onOpenChange={setProjectMenuOpen}
        onOpenWorkspace={(workspace) => {
          void onOpenWorkspace(workspace)
          setProjectMenuOpen(false)
        }}
      />
      {t(hasGitWorkspace ? ' 内开发什么？' : ' 中做些什么？')}
    </>
  ) : (
    t('我们该构建什么？')
  )

  return (
    <div
      ref={pageRef}
      className="quick-chat-workspace tw:flex tw:h-full tw:w-full tw:min-h-0 tw:overflow-hidden"
    >
      <main
        className="quick-chat-view coding-chat-view tw:flex tw:h-full tw:max-w-none tw:w-full tw:min-h-full tw:flex-col tw:items-stretch tw:justify-end tw:overflow-x-hidden tw:overflow-y-auto tw:px-8 tw:pb-4 tw:text-app-text tw:[scrollbar-gutter:stable]"
        onInputCapture={handleComposerInputCapture}
      >
        <section className="quick-chat-hero-region tw:m-auto tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-center tw:justify-end tw:gap-5">
          <div className="quick-chat-hero tw:flex tw:w-[var(--quick-chat-surface-width)] tw:max-w-full tw:flex-col tw:items-center tw:gap-6 tw:text-center tw:text-app-text tw:type-display">
            <button
              ref={whaleMarkRef}
              aria-hidden="true"
              className="quick-chat-mark tw:block tw:size-14 tw:origin-center tw:cursor-pointer tw:select-none tw:border-0 tw:bg-app-text tw:p-0 tw:opacity-30 tw:[mask:url('/whale-icon.svg')_center_no-repeat] tw:[transition:opacity_var(--cpx-sys-motion-micro)_var(--cpx-sys-ease-standard),transform_var(--cpx-sys-motion-state)_var(--cpx-sys-ease-standard)] tw:hover:opacity-40 tw:focus-visible:outline-offset-4"
              tabIndex={-1}
              type="button"
              onClick={handleWhaleMarkClick}
            />
            <CodingHeadingTransition transitionKey={headingKey}>
              {headingContent}
            </CodingHeadingTransition>
          </div>
          <AnimatePresence initial={false}>
            {suggestionState.kind === 'root' ||
            suggestionState.kind === 'templates' ||
            suggestionState.kind === 'category' ? (
              <NewSessionPresence
                key={`suggestions-${suggestionState.kind}${suggestionState.kind === 'category' ? `-${suggestionState.categoryId}` : ''}`}
                kind="panel"
                reducedMotion={reducedMotion}
              >
                <NewSessionSuggestions
                  state={suggestionState}
                  suggestions={suggestions}
                  onSelectSuggestion={handleSelectSuggestion}
                  onSelectCategory={handleSelectCategory}
                  onSelectTask={handleSelectTask}
                  onShowAll={handleShowAll}
                  onShowSuggestions={handleShowSuggestions}
                />
              </NewSessionPresence>
            ) : null}
          </AnimatePresence>
        </section>

        <section className="quick-chat-composer-region tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-center tw:justify-end tw:gap-3">
          {composerProps ? (
            <div className="chat-composer tw:static tw:m-0 tw:flex tw:w-[var(--quick-chat-surface-width)] tw:max-w-full tw:flex-col tw:items-center tw:gap-3 tw:pointer-events-auto">
              <DesktopComposer {...composerProps} surface="coding" />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

function NewSessionPresence({
  children,
  kind,
  reducedMotion,
}: {
  children: React.ReactNode
  kind: 'panel' | 'surface'
  reducedMotion: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()
  const panel = kind === 'panel'
  const offset = panel ? 4 : -4

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1, y: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      className={
        panel
          ? `new-session-${kind}-presence tw:flex tw:w-full tw:min-w-0 tw:justify-center`
          : `new-session-${kind}-presence tw:w-full tw:h-full tw:min-h-0`
      }
      data-presence={isPresent ? 'present' : 'exiting'}
      exit={{
        opacity: 0,
        scale: panel ? 0.985 : 1,
        y: offset,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, scale: panel ? 0.985 : 1, y: 4 }}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      {children}
    </motion.div>
  )
}
