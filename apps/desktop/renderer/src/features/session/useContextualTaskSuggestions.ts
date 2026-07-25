import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopGitStatus,
  DesktopTaskSuggestion,
} from "../../../shared/types.js";
import { desktopClient } from "../../services/desktop-client/index.js";
import {
  buildContextualTaskSuggestions,
  type NewSessionRecentTask,
  type NewSessionTaskSuggestion,
} from "./newSessionSuggestions.js";

const windowsAbsolutePath = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/gu;

const safeRecentPrompt = (value: string | null) =>
  value?.replace(windowsAbsolutePath, "[路径]").slice(0, 500) ?? null;

const normalizedGitContext = (gitStatus: DesktopGitStatus | null) =>
  gitStatus
    ? {
        clean: gitStatus.clean,
        ahead: gitStatus.ahead,
        behind: gitStatus.behind,
        totalFiles: gitStatus.files.length,
        files: gitStatus.files.slice(0, 30).map(file => ({
          path: file.path.replace(windowsAbsolutePath, "[路径]").slice(0, 500),
          status: file.status,
          stagedStatus: file.stagedStatus,
          unstagedStatus: file.unstagedStatus,
        })),
      }
    : null;

const desktopSuggestion = (
  suggestion: DesktopTaskSuggestion,
): NewSessionTaskSuggestion => ({
  id: suggestion.id,
  categoryId: suggestion.categoryId,
  label: suggestion.label,
  prompt: suggestion.prompt,
});

export const shouldApplyGeneratedSuggestions = (input: {
  request: number;
  currentRequest: number;
  interactionVersion: number;
  currentInteractionVersion: number;
  active: boolean;
}) =>
  input.request === input.currentRequest &&
  input.interactionVersion === input.currentInteractionVersion &&
  input.active;

export function useContextualTaskSuggestions(input: {
  active: boolean;
  workspaceName: string | null;
  workspacePath: string | null;
  branchName: string | null;
  gitStatus: DesktopGitStatus | null;
  recentTasks: readonly NewSessionRecentTask[];
}) {
  const git = useMemo(
    () => normalizedGitContext(input.gitStatus),
    [input.gitStatus],
  );
  const recentTasks = useMemo(
    () =>
      input.recentTasks.slice(0, 5).map(task => ({
        ...task,
        title: task.title.slice(0, 160),
        firstPrompt: safeRecentPrompt(task.firstPrompt),
      })),
    [input.recentTasks],
  );
  const localSuggestions = useMemo(
    () => buildContextualTaskSuggestions({ recentTasks, git }),
    [git, recentTasks],
  );
  const context = useMemo(
    () => ({
      workspaceName: input.workspaceName,
      branchName: input.branchName,
      git,
      recentTasks,
      localCandidates: localSuggestions,
    }),
    [
      git,
      input.branchName,
      input.workspaceName,
      localSuggestions,
      recentTasks,
    ],
  );
  const contextSignature = useMemo(
    () => JSON.stringify({
      workspacePath: input.workspacePath,
      context,
    }),
    [context, input.workspacePath],
  );
  const [suggestions, setSuggestions] =
    useState<readonly NewSessionTaskSuggestion[]>(localSuggestions);
  const interactionVersionRef = useRef(0);
  const activeRef = useRef(input.active);
  const requestRef = useRef(0);

  activeRef.current = input.active;

  const markInteracted = useCallback(() => {
    interactionVersionRef.current += 1;
  }, []);

  useEffect(() => {
    setSuggestions(localSuggestions);
    if (!input.active) return;
    const request = ++requestRef.current;
    const interactionVersion = interactionVersionRef.current;
    void desktopClient
      .generateTaskSuggestions({
        workspacePath: input.workspacePath,
        context,
      })
      .then(result => {
        if (!shouldApplyGeneratedSuggestions({
          request,
          currentRequest: requestRef.current,
          interactionVersion,
          currentInteractionVersion: interactionVersionRef.current,
          active: activeRef.current,
        })) {
          return;
        }
        setSuggestions(result.suggestions.map(desktopSuggestion));
      })
      .catch(() => {
        // Local rules remain available when the Agent or model is unavailable.
      });
    return () => {
      if (requestRef.current === request) requestRef.current += 1;
    };
  }, [
    context,
    contextSignature,
    input.active,
    input.workspacePath,
    localSuggestions,
  ]);

  return { suggestions, markInteracted };
}
