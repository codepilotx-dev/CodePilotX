import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { WorkingPlugin } from "./composer/composerTypes.js";
import { DesktopComposer } from "./composer/DesktopComposer.js";
import { useQuickChatContext } from "./QuickChatContext.js";
import { WorkingSuggestionsPanel } from "./WorkingSuggestionsPanel.js";
import { useContextualTaskSuggestions } from "./useContextualTaskSuggestions.js";
import {
  buildWorkingContextualTaskSuggestions,
  createWorkingSuggestionState,
  returnToWorkingSuggestionTemplates,
  selectWorkingSuggestionCategory,
  selectWorkingContextualSuggestion,
  selectWorkingSuggestionTask,
  showContextualWorkingSuggestions,
  showWorkingSuggestionTemplates,
  shouldShowWorkingSuggestions,
  syncWorkingSuggestionState,
  type WorkingSuggestionCategory,
  type WorkingContextualSuggestion,
  type WorkingSuggestionState,
  type WorkingSuggestionTask,
} from "./workingSuggestions.js";

const WORKING_COMPOSER_PLACEHOLDER = "使用 CodePilotX Working";

export function WorkingNewSessionView(): React.ReactNode {
  const {
    branchName,
    composerProps,
    composerDraft,
    gitStatus,
    recentTasks,
    workspaceName,
    workspacePath,
    onAppendComposerText,
  } = useQuickChatContext();
  const [workingPlugin, setWorkingPlugin] = useState<WorkingPlugin | null>(
    null,
  );
  const [observedComposerValue, setObservedComposerValue] = useState(
    composerDraft?.value ?? "",
  );
  const [suggestionState, setSuggestionState] = useState<WorkingSuggestionState>(
    () => createWorkingSuggestionState(composerDraft?.value ?? ""),
  );
  const pageRef = useRef<HTMLDivElement | null>(null);
  const programmaticValueRef = useRef<string | null>(null);
  const composerDraftValue = composerDraft?.value;
  const { suggestions, markInteracted } = useContextualTaskSuggestions({
    surface: "working",
    buildWorkingSuggestions: buildWorkingContextualTaskSuggestions,
    active:
      suggestionState.kind === "root" &&
      observedComposerValue.trim().length === 0,
    workspaceName,
    workspacePath,
    branchName,
    gitStatus,
    recentTasks,
  });

  useEffect(() => {
    if (composerDraftValue === undefined) return;
    setObservedComposerValue(composerDraftValue);
    if (programmaticValueRef.current === composerDraftValue) {
      programmaticValueRef.current = null;
      return;
    }
    setSuggestionState(current =>
      syncWorkingSuggestionState(current, composerDraftValue),
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
    },
    [composerDraft, focusComposer, observedComposerValue, onAppendComposerText],
  );

  const handleSelectCategory = useCallback(
    (category: WorkingSuggestionCategory) => {
      markInteracted();
      setSuggestionState(
        selectWorkingSuggestionCategory(category.id, category.starterPrompt),
      );
      replaceComposerValue(category.starterPrompt);
    },
    [markInteracted, replaceComposerValue],
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: WorkingContextualSuggestion) => {
      markInteracted();
      const result = selectWorkingContextualSuggestion(suggestion);
      setSuggestionState(result.state);
      setWorkingPlugin(result.plugin);
      replaceComposerValue(result.prompt);
    },
    [markInteracted, replaceComposerValue],
  );

  const handleShowTemplates = useCallback(() => {
    markInteracted();
    setSuggestionState(showWorkingSuggestionTemplates());
  }, [markInteracted]);

  const handleShowSuggestions = useCallback(() => {
    markInteracted();
    setSuggestionState(showContextualWorkingSuggestions());
  }, [markInteracted]);

  const handleSelectTask = useCallback(
    (_category: WorkingSuggestionCategory, task: WorkingSuggestionTask) => {
      markInteracted();
      const result = selectWorkingSuggestionTask(suggestionState, task.id);
      if (!result) return;
      setSuggestionState(result.state);
      setWorkingPlugin(result.plugin);
      replaceComposerValue(result.prompt);
    },
    [markInteracted, replaceComposerValue, suggestionState],
  );

  const handleBack = useCallback(
    (_category: WorkingSuggestionCategory) => {
      markInteracted();
      const next = returnToWorkingSuggestionTemplates(
        suggestionState,
        observedComposerValue,
      );
      setSuggestionState(next.state);
      if (next.composerValue !== observedComposerValue) {
        replaceComposerValue(next.composerValue);
      }
    },
    [
      markInteracted,
      observedComposerValue,
      replaceComposerValue,
      suggestionState,
    ],
  );

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
        syncWorkingSuggestionState(current, value),
      );
    },
    [markInteracted],
  );

  const showSuggestions = shouldShowWorkingSuggestions(suggestionState);

  return (
    <div ref={pageRef} className="quick-chat-workspace working-chat-workspace">
      <main
        className="quick-chat-view working-chat-view"
        onInputCapture={handleComposerInputCapture}
      >
        <section className="quick-chat-composer-region tw:justify-start">
          <div className="quick-chat-hero working-chat-hero tw:gap-0">
            <h1>我们该处理什么工作？</h1>
          </div>
          <div
            className="working-composer-interaction tw:flex tw:w-full tw:flex-col tw:items-center tw:gap-3"
          >
            {composerProps ? (
              <div className="chat-composer">
                <DesktopComposer
                  {...composerProps}
                  surface="working"
                  workingPlugin={workingPlugin}
                  onWorkingPluginChange={setWorkingPlugin}
                  placeholder={WORKING_COMPOSER_PLACEHOLDER}
                />
              </div>
            ) : null}
            {showSuggestions ? (
              <WorkingSuggestionsPanel
                state={suggestionState}
                suggestions={suggestions}
                onSelectSuggestion={handleSelectSuggestion}
                onShowTemplates={handleShowTemplates}
                onShowSuggestions={handleShowSuggestions}
                onSelectCategory={handleSelectCategory}
                onSelectTask={handleSelectTask}
                onBack={handleBack}
              />
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
