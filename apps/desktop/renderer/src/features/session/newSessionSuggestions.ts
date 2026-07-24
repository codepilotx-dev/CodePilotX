export type NewSessionSuggestionCategoryId =
  | "codex-explore"
  | "codex-create"
  | "codex-review"
  | "codex-fix";

export type NewSessionSuggestionTone =
  | "blue"
  | "purple"
  | "green"
  | "orange";

export type NewSessionSuggestionTask = {
  id: string;
  label: string;
  prompt: string;
};

export type NewSessionSuggestionCategory = {
  id: NewSessionSuggestionCategoryId;
  label: string;
  starter: string;
  tone: NewSessionSuggestionTone;
  tasks: readonly NewSessionSuggestionTask[];
};

export const NEW_SESSION_SUGGESTIONS = [
  {
    id: "codex-explore",
    label: "探索并理解代码",
    starter: "Explore ",
    tone: "blue",
    tasks: [
      {
        id: "explore-feature",
        label: "某项功能如何工作",
        prompt: "Explore how a feature works in this codebase",
      },
      {
        id: "explore-options",
        label: "比较几种实现方案",
        prompt: "Explore implementation options for a change in this codebase",
      },
      {
        id: "explore-architecture",
        label: "梳理架构权衡",
        prompt: "Explore the architectural tradeoffs in this codebase",
      },
      {
        id: "explore-api",
        label: "了解一个 API 并补充文档",
        prompt: "Explore an API in this codebase and document how it works",
      },
    ],
  },
  {
    id: "codex-create",
    label: "构建新功能、应用或工具",
    starter: "Build ",
    tone: "purple",
    tasks: [
      {
        id: "create-feature",
        label: "构建一项新功能",
        prompt: "Build a new feature in this codebase",
      },
      {
        id: "create-ui",
        label: "实现一组界面改动",
        prompt: "Build a set of UI changes in this codebase",
      },
      {
        id: "create-prototype",
        label: "搭建一个可运行原型",
        prompt: "Build a working prototype in this codebase",
      },
      {
        id: "create-tool",
        label: "创建一个内部工具",
        prompt: "Build an internal tool for this codebase",
      },
    ],
  },
  {
    id: "codex-review",
    label: "审查代码并提出修改建议",
    starter: "Review ",
    tone: "green",
    tasks: [
      {
        id: "review-changes",
        label: "审查当前改动",
        prompt: "Review my current changes and suggest improvements",
      },
      {
        id: "review-pr",
        label: "审查一个拉取请求",
        prompt: "Review a pull request and suggest improvements",
      },
      {
        id: "review-tests",
        label: "检查测试覆盖",
        prompt: "Review the test coverage for the current changes",
      },
      {
        id: "review-refactor",
        label: "评估一次重构",
        prompt: "Review a refactor and identify risks or improvements",
      },
    ],
  },
  {
    id: "codex-fix",
    label: "修复问题和失败",
    starter: "Fix ",
    tone: "orange",
    tasks: [
      {
        id: "fix-bug",
        label: "修复一个缺陷",
        prompt: "Fix a bug in this codebase",
      },
      {
        id: "fix-tests",
        label: "修复失败的测试",
        prompt: "Fix the failing tests in this codebase",
      },
      {
        id: "fix-ci",
        label: "排查 CI 失败",
        prompt: "Fix the CI failures in this codebase",
      },
      {
        id: "fix-conflicts",
        label: "解决合并冲突",
        prompt: "Fix the merge conflicts in this codebase",
      },
    ],
  },
] as const satisfies readonly NewSessionSuggestionCategory[];

export function findNewSessionSuggestionCategory(
  categoryId: NewSessionSuggestionCategoryId,
): NewSessionSuggestionCategory {
  return NEW_SESSION_SUGGESTIONS.find(category => category.id === categoryId)!;
}
