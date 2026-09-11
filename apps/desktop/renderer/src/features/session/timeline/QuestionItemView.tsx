import React from "react";
import { Check, ChevronDown, ListChecks, MessageCircleQuestion } from "lucide-react";
import type { Item, QuestionItem } from "@codepilotx/shared/thread";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import { DisclosureContent } from "../../../components/ui/DisclosureContent.js";
import type { ResolvedCanonicalItemDisclosure } from "./CanonicalItemRenderer.js";

/** A persisted question owns its tool's presentation, but never hides tool failures. */
export function questionTimelineItems(processItems: readonly Item[], items: readonly Item[]): Item[] {
  const questionCalls = new Set(items.flatMap(item =>
    item.type === "question" && item.toolCallId ? [item.toolCallId] : [],
  ));
  return processItems.filter(item => item.type !== "tool"
    || item.tool.split(/[./]/).at(-1)?.toLowerCase() !== "request_user_input"
    || !questionCalls.has(item.callID)
    || item.state === "error"
    || item.state === "interrupted");
}

export function QuestionItemView({ item, disclosure }: {
  item: QuestionItem;
  disclosure?: ResolvedCanonicalItemDisclosure;
}): React.ReactNode {
  const [localExpanded, setLocalExpanded] = React.useState(false);
  const expanded = disclosure?.expanded ?? localExpanded;
  const contentId = React.useId();
  if (item.status === "pending") {
    return (
      <div data-question-id={item.id} data-state={item.status}>
        <div className="canonical-lifecycle-tool">
          <MessageCircleQuestion size={APP_ICON_SIZE} aria-hidden="true" />
          <span>正在询问问题</span>
        </div>
        <div className="canonical-lifecycle-tool" role="status">
          <ListChecks size={APP_ICON_SIZE} aria-hidden="true" />
          <span>正在等待你的回答</span>
        </div>
      </div>
    );
  }
  const allSkipped = Boolean(item.answers?.length && item.questions?.length === item.answers.length && item.answers.every(answer => answer.skipped));
  const label = item.status === "answered" ? allSkipped ? "未提供答案" : "已回答" : item.status === "ignored" ? "已跳过" : "已取消";
  return (
    <div className="canonical-process-card" data-question-id={item.id} data-state={item.status} data-expanded={expanded}>
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="canonical-process-card__summary"
        onClick={() => disclosure
          ? disclosure.onExpandedChange(disclosure.id, !expanded)
          : setLocalExpanded(!expanded)}
        type="button"
      >
        <Check size={APP_ICON_SIZE} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={APP_ICON_SIZE} className="canonical-process-card__chevron" aria-hidden="true" />
      </button>
      <DisclosureContent contentClassName="canonical-process-card__body" expanded={expanded} id={contentId} mountPolicy="until-exit">
        {item.questions?.length ? item.questions.map(question => {
          const answer = item.answers?.find(candidate => candidate.questionId === question.id);
          const choices = answer?.choiceIds.map(id => question.choices.find(choice => choice.id === id)?.label ?? id) ?? [];
          const text = [...choices, answer?.text].filter(Boolean).join("；");
          return (
            <div key={question.id}>
              <strong>{question.prompt}</strong>
              <p>{answer?.skipped ? "未提供答案" : text || (item.status === "answered" ? "未提供答案" : label)}</p>
            </div>
          );
        }) : <><strong>{item.prompt}</strong><p>{item.answer || label}</p></>}
      </DisclosureContent>
    </div>
  );
}
