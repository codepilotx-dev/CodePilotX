import React from "react";
import { Maximize2, PanelRight } from "lucide-react";
import type { StructuredPlan } from "@codepilotx/shared/thread";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../../components/ui/iconTokens.js";
import { MarkdownMessage } from "../../markdown/index.js";

export type OpenPlanInDockRequest = {
  eventId: string;
  title: string;
  content: string;
  /**
   * 计划是否已生成完成。右栏计划 tab 的内容是打开瞬间的快照，因此流式期间
   * 打开会冻结半成品；打开入口必须据此拒绝，而不是只隐藏按钮。
   */
  openable: boolean;
};

/**
 * 构造右栏打开请求。`openable` 只在计划生成完成后为真：右栏 tab 的内容是打开
 * 瞬间的快照，流式期间打开会冻结半成品。打开入口据此拒绝，而不是只隐藏按钮。
 */
export function createPlanDockRequest(input: {
  eventId: string;
  title: string;
  content: string;
  streaming: boolean;
}): OpenPlanInDockRequest {
  return {
    eventId: input.eventId,
    title: input.title,
    content: input.content,
    openable: !input.streaming,
  };
}

export function WorkflowPlanCard({
  eventId,
  summary,
  structured,
  streaming,
  isDocked,
  onOpenInRightDock,
}: {
  eventId: string;
  summary: string;
  structured?: StructuredPlan;
  streaming: boolean;
  isDocked: boolean;
  onOpenInRightDock: (plan: OpenPlanInDockRequest) => void;
}): React.ReactNode {
  const title = structured?.title ?? planTitleFromSummary(summary);
  const presentation = planCardPresentation({ streaming, isDocked });
  const plan = createPlanDockRequest({ eventId, title, content: summary, streaming });

  if (presentation.compact) {
    return (
      <article className="workflow-plan-card workflow-plan-card--compact">
        <button
          className="workflow-plan-card__compact-button"
          type="button"
          onClick={() => onOpenInRightDock(plan)}
        >
          <span className="workflow-plan-card__label">
            {presentation.label}
          </span>
          <span className="workflow-plan-card__compact-title">{title}</span>
          <PanelRight
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </button>
      </article>
    );
  }

  return (
    <article className="workflow-plan-card">
      <header className="workflow-plan-card__header">
        <span className="workflow-plan-card__label">{presentation.label}</span>
        <div className="workflow-plan-card__actions">
          {presentation.showOpenInRightDock ? (
            <button
              aria-label="在右侧打开计划"
              className="workflow-plan-card__dock"
              title="在右侧打开计划"
              type="button"
              onClick={() => onOpenInRightDock(plan)}
            >
              <Maximize2
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </button>
          ) : null}
        </div>
      </header>

      <h2 className="workflow-plan-card__title">{title}</h2>

      <div className="workflow-plan-card__body">
        {structured ? (
          <StructuredPlanView plan={structured} />
        ) : (
          <MarkdownMessage text={summary} />
        )}
      </div>
    </article>
  );
}

/**
 * 结构化计划的唯一展示实现：按固定语义顺序渲染摘要、按 area 分组的实现项、
 * 接口变化、测试和假设；空的可选章节不渲染。Markdown 只作为历史与兼容回退。
 */
export function StructuredPlanView({
  plan,
}: {
  plan: StructuredPlan;
}): React.ReactNode {
  return (
    <div className="workflow-plan-structured">
      <p className="workflow-plan-structured__summary">{plan.summary}</p>
      <StructuredPlanSection title="实现变更">
        {plan.changes.map((change, index) => (
          <div
            className="workflow-plan-structured__change"
            key={`${change.area}:${index}`}
          >
            <h4 className="workflow-plan-structured__area">{change.area}</h4>
            <ul className="workflow-plan-structured__list">
              {change.items.map((item, itemIndex) => (
                <li key={`${item}:${itemIndex}`}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </StructuredPlanSection>
      <StructuredPlanListSection title="接口变化" items={plan.interfaceChanges} />
      <StructuredPlanListSection title="测试" items={plan.tests} />
      <StructuredPlanListSection title="假设" items={plan.assumptions} />
    </div>
  );
}

function StructuredPlanListSection({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}): React.ReactNode {
  if (items.length === 0) return null;
  return (
    <StructuredPlanSection title={title}>
      <ul className="workflow-plan-structured__list">
        {items.map((item, index) => (
          <li key={`${item}:${index}`}>{item}</li>
        ))}
      </ul>
    </StructuredPlanSection>
  );
}

function StructuredPlanSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="workflow-plan-structured__section">
      <h3 className="workflow-plan-structured__heading">{title}</h3>
      {children}
    </section>
  );
}

export function planTitleFromSummary(summary: string): string {
  const heading = summary.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const proposedTitle = summary.match(/^\s*title:\s*(.+)$/im)?.[1]?.trim();
  return proposedTitle || "计划书";
}

export function planCardPresentation({
  streaming,
  isDocked,
}: {
  streaming: boolean;
  isDocked: boolean;
}): {
  compact: boolean;
  label: string;
  showOpenInRightDock: boolean;
  showFoldControls: boolean;
} {
  return {
    compact: isDocked,
    label: streaming ? "编写计划" : "计划",
    showOpenInRightDock: !streaming,
    showFoldControls: false,
  };
}
