import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Item, QuestionItem } from "@codepilotx/shared/thread";
import { QuestionItemView, questionTimelineItems } from "../src/features/session/timeline/QuestionItemView.js";

const question: QuestionItem = {
  id: "interaction-1", messageID: "message-1", turnId: "turn-1", agentId: "agent-1",
  type: "question", toolCallId: "call-1", prompt: "导出什么？", choices: [],
  status: "pending", answer: null, createdAt: 1,
  questions: ["对象", "格式", "范围"].map((label, index) => ({
    id: `question-${index}`, header: label, prompt: `${label}如何选择？`,
    choices: [{ id: "first", label: `${label}选项一` }, { id: "second", label: `${label}选项二` }],
    allowFreeform: true, required: true,
  })),
};

describe("question timeline", () => {
  test("pending groups only show two status nodes, resolved groups collapse all answers", () => {
    const pending = renderToStaticMarkup(<QuestionItemView item={question} />);
    expect(pending).toContain("正在询问问题");
    expect(pending).toContain("正在等待你的回答");
    expect(pending).not.toContain("如何选择");
    expect(pending).not.toContain("选项一");
    const answered: QuestionItem = {
      ...question, status: "answered",
      answers: question.questions!.map((q, index) => ({ questionId: q.id, choiceIds: index === 2 ? [] : ["second"], ...(index === 2 ? { text: "自定义范围" } : {}) })),
    };
    const collapsed = renderToStaticMarkup(<QuestionItemView item={answered} />);
    expect(collapsed).toContain("已回答");
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain("正在等待");
    expect(collapsed).not.toContain("如何选择");
    const expanded = renderToStaticMarkup(<QuestionItemView item={answered} disclosure={{ id: question.id, expanded: true, onExpandedChange: () => {} }} />);
    expect(expanded).toContain("对象选项二");
    expect(expanded).toContain("格式选项二");
    expect(expanded).toContain("自定义范围");
    expect(expanded).not.toContain("对象选项一");
    for (const [status, label] of [["ignored", "已跳过"], ["cancelled", "已取消"]] as const) {
      expect(renderToStaticMarkup(<QuestionItemView item={{ ...question, status }} />)).toContain(label);
    }
  });

  test("only the exact question tool call is deduplicated and failures stay visible", () => {
    const tool: Extract<Item, { type: "tool" }> = {
      id: "tool-1", messageID: "message-1", turnId: "turn-1", agentId: "agent-1", type: "tool",
      callID: "call-1", tool: "request_user_input", title: "提问", state: "completed",
      input: null, command: null, output: null, error: null, startedAt: 1, finishedAt: 2, durationMs: 1, createdAt: 1,
    };
    const unrelated = { ...tool, id: "tool-2", callID: "call-2" };
    expect(questionTimelineItems([tool, unrelated], [tool, unrelated, question])).toEqual([unrelated]);
    expect(questionTimelineItems([tool], [tool])).toEqual([tool]);
    for (const state of ["error", "interrupted"] as const) {
      const failed = { ...tool, state };
      expect(questionTimelineItems([failed], [failed, question])).toEqual([failed]);
    }
  });
});
