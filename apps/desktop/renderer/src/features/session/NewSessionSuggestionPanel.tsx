import type React from "react";
import {
  ArrowLeft,
  Bug,
  Hammer,
  ListChecks,
  SearchCode,
} from "lucide-react";
import type { NewSessionSuggestionState } from "./newSessionSuggestionState.js";
import {
  findNewSessionSuggestionCategory,
  NEW_SESSION_SUGGESTIONS,
  type NewSessionSuggestionCategory,
  type NewSessionSuggestionCategoryId,
  type NewSessionSuggestionTask,
  type NewSessionTaskSuggestion,
} from "./newSessionSuggestions.js";

type NewSessionSuggestionPanelProps = {
  state: NewSessionSuggestionState;
  suggestions: readonly NewSessionTaskSuggestion[];
  onSelectSuggestion: (suggestion: NewSessionTaskSuggestion) => void;
  onSelectCategory: (category: NewSessionSuggestionCategory) => void;
  onSelectTask: (
    category: NewSessionSuggestionCategory,
    task: NewSessionSuggestionTask,
  ) => void;
  onShowAll: (category: NewSessionSuggestionCategory) => void;
  onShowSuggestions: () => void;
};

const CATEGORY_ICONS: Record<
  NewSessionSuggestionCategoryId,
  React.ComponentType<{ "aria-hidden"?: boolean; size?: number }>
> = {
  "codex-explore": SearchCode,
  "codex-create": Hammer,
  "codex-review": ListChecks,
  "codex-fix": Bug,
};

export function NewSessionSuggestions({
  state,
  suggestions,
  onSelectSuggestion,
  onSelectCategory,
  onSelectTask,
  onShowAll,
  onShowSuggestions,
}: NewSessionSuggestionPanelProps): React.ReactNode {
  if (state.kind === "hidden") return null;

  if (state.kind === "root") {
    return (
      <section
        aria-label="建议任务"
        className="new-session-suggestions is-root"
      >
        <div className="new-session-suggestion-grid">
          {suggestions.map((suggestion, index) => {
            const category = findNewSessionSuggestionCategory(
              suggestion.categoryId,
            );
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <button
                key={suggestion.id}
                aria-label={suggestion.label}
                className={`new-session-suggestion-card is-${category.tone}`}
                style={
                  {
                    "--new-session-suggestion-index": index,
                  } as React.CSSProperties
                }
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
              >
                <span className="new-session-suggestion-icon">
                  <Icon aria-hidden size={16} />
                </span>
                <span className="new-session-suggestion-label">
                  {suggestion.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  if (state.kind === "templates") {
    return (
      <section
        aria-label="选择一个任务模板"
        className="new-session-suggestions is-root is-templates"
      >
        <div className="new-session-suggestion-list-heading">
          <span>任务模板</span>
          <button type="button" onClick={onShowSuggestions}>
            <ArrowLeft aria-hidden size={14} />
            返回建议
          </button>
        </div>
        <div className="new-session-suggestion-grid">
          {NEW_SESSION_SUGGESTIONS.map((category, index) => {
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <button
                key={category.id}
                aria-label={category.label}
                className={`new-session-suggestion-card is-${category.tone}`}
                style={
                  {
                    "--new-session-suggestion-index": index,
                  } as React.CSSProperties
                }
                type="button"
                onClick={() => onSelectCategory(category)}
              >
                <span className="new-session-suggestion-icon">
                  <Icon aria-hidden size={16} />
                </span>
                <span className="new-session-suggestion-label">
                  {category.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const category = findNewSessionSuggestionCategory(state.categoryId);
  const Icon = CATEGORY_ICONS[category.id];

  return (
    <section
      aria-label={`${category.label}的建议任务`}
      className={`new-session-suggestions is-follow-up is-${category.tone}`}
    >
      <div className="new-session-suggestion-list-heading">
        <span>
          <Icon aria-hidden size={16} />
          {category.label}
        </span>
        <button type="button" onClick={() => onShowAll(category)}>
          <ArrowLeft aria-hidden size={14} />
          显示全部
        </button>
      </div>
      <div className="new-session-suggestion-list">
        {category.tasks.map((task, index) => (
          <button
            key={task.id}
            className="new-session-suggestion-row"
            style={
              {
                "--new-session-suggestion-index": index,
              } as React.CSSProperties
            }
            type="button"
            onClick={() => onSelectTask(category, task)}
          >
            <span aria-hidden className="new-session-suggestion-prefix">
              {category.starter.trim()}
            </span>
            <span>{task.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
