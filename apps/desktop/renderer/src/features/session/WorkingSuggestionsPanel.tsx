import type React from "react";
import { ArrowLeft, CalendarClock, GitMerge, LayoutGrid } from "lucide-react";
import type { WorkingSuggestionState } from "./workingSuggestions.js";
import {
  findWorkingSuggestionCategory,
  WORKING_SUGGESTION_CATEGORIES,
  type WorkingSuggestionCategory,
  type WorkingSuggestionCategoryId,
  type WorkingSuggestionTask,
} from "./workingSuggestions.js";

const CATEGORY_ICONS: Record<
  WorkingSuggestionCategoryId,
  React.ComponentType<{
    "aria-hidden"?: boolean;
    className?: string;
    size?: number;
  }>
> = {
  today: CalendarClock,
  complex: GitMerge,
  "multi-project": LayoutGrid,
};

type WorkingSuggestionsPanelProps = {
  state: WorkingSuggestionState;
  onSelectCategory: (category: WorkingSuggestionCategory) => void;
  onSelectTask: (
    category: WorkingSuggestionCategory,
    task: WorkingSuggestionTask,
  ) => void;
  onBack: (category: WorkingSuggestionCategory) => void;
};

/**
 * Working 首屏的无卡片纵向建议列表：第一层三个分类，第二层对应任务列表。
 * 复用 NewSessionSuggestions 的行与标题基础样式（hover、focus、动效、reduced-motion），
 * 但不用卡片网格与 .is-follow-up 面板背景，仅保留 Working 差异覆盖。
 */
export function WorkingSuggestionsPanel({
  state,
  onSelectCategory,
  onSelectTask,
  onBack,
}: WorkingSuggestionsPanelProps): React.ReactNode {
  if (state.kind === "hidden") return null;

  if (state.kind === "root") {
    return (
      <section
        aria-label="工作建议"
        className="working-suggestions tw:max-w-full"
        style={{ width: "var(--quick-chat-surface-width)" }}
      >
        <div className="working-suggestion-list tw:grid tw:gap-0.5">
          {WORKING_SUGGESTION_CATEGORIES.map((category, index) => {
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <button
                key={category.id}
                className="new-session-suggestion-row working-suggestion-row"
                style={
                  {
                    "--new-session-suggestion-index": index,
                    minHeight: 44,
                  } as React.CSSProperties
                }
                type="button"
                onClick={() => onSelectCategory(category)}
              >
                <Icon
                  aria-hidden
                  className="tw:shrink-0 tw:text-app-text-soft"
                  size={16}
                />
                <span>{category.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const category = findWorkingSuggestionCategory(state.categoryId);
  const Icon = CATEGORY_ICONS[category.id];

  return (
    <section
      aria-label={`${category.label}的建议任务`}
      className="working-suggestions tw:max-w-full"
      style={{ width: "var(--quick-chat-surface-width)" }}
    >
      <div className="working-suggestion-list tw:grid tw:gap-0.5">
        <div className="new-session-suggestion-list-heading working-suggestion-list-heading">
          <span className="tw:text-app-text-soft">
            <Icon
              aria-hidden
              className="tw:shrink-0 tw:text-app-text-soft"
              size={16}
            />
            {category.label}
          </span>
          <button type="button" onClick={() => onBack(category)}>
            <ArrowLeft aria-hidden size={14} />
            返回
          </button>
        </div>
        {category.tasks.map((task, index) => (
          <button
            key={task.id}
            className="new-session-suggestion-row working-suggestion-row"
            style={
              {
                "--new-session-suggestion-index": index,
                minHeight: 44,
              } as React.CSSProperties
            }
            type="button"
            onClick={() => onSelectTask(category, task)}
          >
            <span>{task.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
