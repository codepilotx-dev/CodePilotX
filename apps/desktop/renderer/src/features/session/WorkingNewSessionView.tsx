import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { DesktopWorkspace } from "../../../shared/types.js";
import type { WorkingPlugin } from "./composer/composerTypes.js";
import { DesktopComposer } from "./composer/DesktopComposer.js";
import { ProjectSwitcherPopover } from "./composer/ProjectSwitcherPopover.js";
import { useQuickChatContext } from "./QuickChatContext.js";
import { WorkingSuggestionsPanel } from "./WorkingSuggestionsPanel.js";
import {
  createWorkingSuggestionState,
  returnToWorkingSuggestionRoot,
  selectWorkingSuggestionCategory,
  selectWorkingSuggestionTask,
  shouldShowWorkingSuggestions,
  syncWorkingSuggestionState,
  type WorkingSuggestionCategory,
  type WorkingSuggestionState,
  type WorkingSuggestionTask,
} from "./workingSuggestions.js";

const WORKING_COMPOSER_PLACEHOLDER = "描述正在推进的工作、目标或阻塞……";

export function WorkingNewSessionView(): React.ReactNode {
  const {
    branchName,
    composerProps,
    composerDraft,
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
  const [workingPlugin, setWorkingPlugin] = useState<WorkingPlugin | null>(
    null,
  );
  const [suggestionsFocused, setSuggestionsFocused] = useState(false);
  const [observedComposerValue, setObservedComposerValue] = useState(
    composerDraft?.value ?? "",
  );
  const [suggestionState, setSuggestionState] = useState<WorkingSuggestionState>(
    () => createWorkingSuggestionState(composerDraft?.value ?? ""),
  );
  const pageRef = useRef<HTMLDivElement | null>(null);
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

  const composerDraftValue = composerDraft?.value;

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
      setSuggestionState(
        selectWorkingSuggestionCategory(category.id, category.label),
      );
      replaceComposerValue(category.label);
    },
    [replaceComposerValue],
  );

  const handleSelectTask = useCallback(
    (_category: WorkingSuggestionCategory, task: WorkingSuggestionTask) => {
      const result = selectWorkingSuggestionTask(suggestionState, task.id);
      if (!result) return;
      setSuggestionState(result.state);
      setWorkingPlugin(result.plugin);
      replaceComposerValue(result.prompt);
    },
    [replaceComposerValue, suggestionState],
  );

  const handleBack = useCallback(
    (category: WorkingSuggestionCategory) => {
      const next = returnToWorkingSuggestionRoot(
        suggestionState,
        observedComposerValue,
      );
      setSuggestionState(next.state);
      if (next.composerValue !== observedComposerValue) {
        replaceComposerValue(next.composerValue);
      }
    },
    [observedComposerValue, replaceComposerValue, suggestionState],
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
      programmaticValueRef.current = null;
      setObservedComposerValue(value);
      setSuggestionState(current =>
        syncWorkingSuggestionState(current, value),
      );
    },
    [],
  );

  const handleInteractionFocus = useCallback(() => {
    setSuggestionsFocused(true);
  }, []);

  const handleInteractionBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        // 焦点仍在交互区域内（例如移到建议按钮），保持建议可见
        return;
      }
      setSuggestionsFocused(false);
    },
    [],
  );

  const showSuggestions = shouldShowWorkingSuggestions(
    suggestionState,
    suggestionsFocused,
  );

  return (
    <div ref={pageRef} className="quick-chat-workspace working-chat-workspace">
      <main
        className="quick-chat-view working-chat-view"
        onInputCapture={handleComposerInputCapture}
      >
        <section className="quick-chat-composer-region tw:justify-start">
          <div className="quick-chat-hero working-chat-hero tw:gap-0">
            <h1>今天想推进哪些工作？</h1>
          </div>
          <div
            className="working-composer-interaction tw:flex tw:w-full tw:flex-col tw:items-center tw:gap-3"
            onBlurCapture={handleInteractionBlur}
            onFocusCapture={handleInteractionFocus}
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
