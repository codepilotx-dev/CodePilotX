import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useSearchParams } from "react-router-dom";
import type { DesktopWorkspace } from "../../../shared/types.js";
import { useDesktopSettings } from "../settings/useDesktopSettings.js";
import { NewSessionSuggestions } from "./NewSessionSuggestionPanel.js";
import {
  createNewSessionSuggestionState,
  removeGeneratedSuggestionStarter,
  selectNewSessionSuggestionCategory,
  showContextualNewSessionSuggestions,
  showNewSessionSuggestionTemplates,
  syncNewSessionSuggestionState,
} from "./newSessionSuggestionState.js";
import type {
  NewSessionSuggestionCategory,
  NewSessionSuggestionTask,
  NewSessionTaskSuggestion,
} from "./newSessionSuggestions.js";
import {
  normalizeNewSessionSurfaceSearch,
  parseNewSessionSurface,
} from "./newSessionSurface.js";
import { ProjectSwitcherPopover } from "./composer/ProjectSwitcherPopover.js";
import { DesktopComposer } from "./composer/DesktopComposer.js";
import { useQuickChatContext } from "./QuickChatContext.js";
import { useContextualTaskSuggestions } from "./useContextualTaskSuggestions.js";

const WorkingNewSessionView = lazy(() =>
  import("./WorkingNewSessionView.js").then(module => ({
    default: module.WorkingNewSessionView,
  })),
);

export function QuickChatView(): React.ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sidebarProductMode, setSidebarProductMode } = useDesktopSettings();
  const search = searchParams.toString();
  const urlSurface = parseNewSessionSurface(search);
  const surface = urlSurface ?? sidebarProductMode;

  // 缺失或无效的 surface 参数回退到已保存模式，并只替换 surface 参数
  useEffect(() => {
    if (urlSurface === surface) return;
    setSearchParams(
      normalizeNewSessionSurfaceSearch(search, surface),
      { replace: true },
    );
  }, [search, setSearchParams, surface, urlSurface]);

  // URL 中的有效 surface 优先于已保存设置，并同步侧栏模式
  useEffect(() => {
    if (urlSurface === null || urlSurface === sidebarProductMode) return;
    setSidebarProductMode(urlSurface);
  }, [setSidebarProductMode, sidebarProductMode, urlSurface]);

  if (surface === "working") {
    return (
      <Suspense fallback={null}>
        <WorkingNewSessionView />
      </Suspense>
    );
  }

  return <CodingQuickChatView />;
}

function CodingQuickChatView(): React.ReactNode {
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
  } = useQuickChatContext();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [observedComposerValue, setObservedComposerValue] = useState(
    composerDraft?.value ?? "",
  );
  const [suggestionState, setSuggestionState] = useState(() =>
    createNewSessionSuggestionState(composerDraft?.value ?? ""),
  );
  const pageRef = useRef<HTMLDivElement | null>(null);
  const whaleMarkRef = useRef<HTMLButtonElement | null>(null);
  const whaleMarkAnimationRef = useRef<Animation | null>(null);
  const programmaticValueRef = useRef<string | null>(null);
  const currentWorkspace = useMemo<DesktopWorkspace | null>(() => {
    if (!workspaceName || !workspacePath) return null;
    return (
      recentWorkspaces.find(workspace => workspace.path === workspacePath) ?? {
        name: workspaceName,
        path: workspacePath,
        branchName,
      }
    );
  }, [branchName, recentWorkspaces, workspaceName, workspacePath]);
  const { suggestions, markInteracted } = useContextualTaskSuggestions({
    active:
      suggestionState.kind === "root" &&
      observedComposerValue.trim().length === 0,
    workspaceName,
    workspacePath,
    branchName,
    gitStatus,
    recentTasks,
  });

  const composerDraftValue = composerDraft?.value;

  useEffect(() => {
    if (composerDraftValue === undefined) return;
    setObservedComposerValue(composerDraftValue);
    if (programmaticValueRef.current === composerDraftValue) {
      programmaticValueRef.current = null;
      return;
    }
    setSuggestionState(current =>
      syncNewSessionSuggestionState(current, composerDraftValue),
    );
  }, [composerDraftValue]);

  const focusComposer = useCallback(() => {
    if (composerDraft?.focus) {
      composerDraft.focus();
      return;
    }
    const editor = pageRef.current?.querySelector<HTMLElement>(
      "textarea, [contenteditable='true']",
    );
    editor?.focus();
  }, [composerDraft]);

  const replaceComposerValue = useCallback(
    (value: string) => {
      programmaticValueRef.current = value;
      setObservedComposerValue(value);
      if (composerDraft) {
        composerDraft.replace(value);
      } else if (observedComposerValue.length === 0) {
        onAppendComposerText(value);
      }
      requestAnimationFrame(focusComposer);
    }, [composerDraft, focusComposer, observedComposerValue, onAppendComposerText],
  );

  const handleSelectCategory = useCallback(
    (category: NewSessionSuggestionCategory) => {
      markInteracted();
      setSuggestionState(selectNewSessionSuggestionCategory(category.id));
      replaceComposerValue(category.starter);
    },
    [markInteracted, replaceComposerValue],
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: NewSessionTaskSuggestion) => {
      markInteracted();
      setSuggestionState({ kind: "hidden", reason: "custom-input" });
      replaceComposerValue(suggestion.prompt);
    },
    [markInteracted, replaceComposerValue],
  );

  const handleSelectTask = useCallback(
    (
      category: NewSessionSuggestionCategory,
      task: NewSessionSuggestionTask,
    ) => {
      markInteracted();
      if (!composerDraft && observedComposerValue === category.starter) {
        const completion = task.prompt.startsWith(category.starter)
          ? task.prompt.slice(category.starter.length)
          : task.prompt;
        programmaticValueRef.current = task.prompt;
        setObservedComposerValue(task.prompt);
        onAppendComposerText(completion);
        requestAnimationFrame(focusComposer);
        return;
      }
      replaceComposerValue(task.prompt);
    },
    [
      composerDraft,
      focusComposer,
      markInteracted,
      observedComposerValue,
      onAppendComposerText,
      replaceComposerValue,
    ],
  );

  const handleShowAll = useCallback(
    (category: NewSessionSuggestionCategory) => {
      markInteracted();
      const nextValue = removeGeneratedSuggestionStarter(
        observedComposerValue,
        category.starter,
      );
      setSuggestionState(showNewSessionSuggestionTemplates());
      if (nextValue !== observedComposerValue) replaceComposerValue(nextValue);
    },
    [markInteracted, observedComposerValue, replaceComposerValue],
  );

  const handleShowSuggestions = useCallback(() => {
    markInteracted();
    setSuggestionState(showContextualNewSessionSuggestions());
  }, [markInteracted]);

  const handleComposerInputCapture = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      const target = event.target;
      let value: string | null = null;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement
      ) {
        value = target.value;
      } else if (target instanceof HTMLElement && target.isContentEditable) {
        value = target.textContent ?? "";
      }
      if (value === null) return;
      markInteracted();
      programmaticValueRef.current = null;
      setObservedComposerValue(value);
      setSuggestionState(current =>
        syncNewSessionSuggestionState(current, value),
      );
    },
    [markInteracted],
  );

  const handleWhaleMarkClick = useCallback(() => {
    const mark = whaleMarkRef.current;
    if (
      !mark ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    whaleMarkAnimationRef.current?.cancel();
    whaleMarkAnimationRef.current = mark.animate(
      [
        { transform: "scale(1) rotate(0deg)" },
        { transform: "scale(1.08) rotate(180deg)", offset: 0.5 },
        { transform: "scale(1) rotate(360deg)" },
      ],
      {
        duration: 420,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    );
  }, []);

  useEffect(
    () => () => {
      whaleMarkAnimationRef.current?.cancel();
    },
    [],
  );

  const hasGitWorkspace = Boolean(branchName || gitStatus);
  const headingUsesProject = Boolean(workspaceName && workspaceName.length <= 15);
  const headingVerb = hasGitWorkspace ? "构建" : "开展";

  return (
    <div ref={pageRef} className="quick-chat-workspace">
      <main
        className="quick-chat-view"
        onInputCapture={handleComposerInputCapture}
      >
        <section className="quick-chat-hero-region">
          <div className="quick-chat-hero">
            <button
              ref={whaleMarkRef}
              aria-label="旋转鲸鱼图标"
              className="quick-chat-mark"
              type="button"
              onClick={handleWhaleMarkClick}
            />
            {headingUsesProject ? (
              <h1>
                我们应该在{" "}
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
                      aria-label="选择项目"
                      className="project-name"
                      type="button"
                    >
                      {workspaceName}
                    </button>
                  }
                  width={200}
                  workspace={currentWorkspace}
                  onChooseWorkspace={() => {
                    void onChooseWorkspace();
                    setProjectMenuOpen(false);
                  }}
                  onCloneGithub={() => {
                    onCloneGithub();
                    setProjectMenuOpen(false);
                  }}
                  onClearWorkspace={() => {
                    onClearWorkspace();
                    setProjectMenuOpen(false);
                  }}
                  onOpenChange={setProjectMenuOpen}
                  onOpenWorkspace={workspace => {
                    void onOpenWorkspace(workspace);
                    setProjectMenuOpen(false);
                  }}
                />
                {" "}
                中{headingVerb}什么？
              </h1>
            ) : (
              <h1>
                {hasGitWorkspace ? "我们应该构建什么？" : "我们该做什么？"}
              </h1>
            )}
          </div>
          {suggestionState.kind === "root" ||
          suggestionState.kind === "templates" ? (
            <NewSessionSuggestions
              state={suggestionState}
              suggestions={suggestions}
              onSelectSuggestion={handleSelectSuggestion}
              onSelectCategory={handleSelectCategory}
              onSelectTask={handleSelectTask}
              onShowAll={handleShowAll}
              onShowSuggestions={handleShowSuggestions}
            />
          ) : null}
        </section>

        <section className="quick-chat-composer-region">
          {suggestionState.kind === "category" ? (
            <NewSessionSuggestions
              state={suggestionState}
              suggestions={suggestions}
              onSelectSuggestion={handleSelectSuggestion}
              onSelectCategory={handleSelectCategory}
              onSelectTask={handleSelectTask}
              onShowAll={handleShowAll}
              onShowSuggestions={handleShowSuggestions}
            />
          ) : null}
          {composerProps ? (
            <div className="chat-composer">
              <DesktopComposer {...composerProps} />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
