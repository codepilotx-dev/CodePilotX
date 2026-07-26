import React from "react";
import { Check, Circle, LoaderCircle } from "lucide-react";
import type { Item } from "@codepilotx/shared/thread";

type ExecutionPlanItem = Extract<Item, { type: "execution-plan" }>;
type ExecutionPlanStep = ExecutionPlanItem["steps"][number];

export function ExecutionPlanCard({
  item,
}: {
  item: ExecutionPlanItem;
}): React.ReactNode {
  const completed = item.steps.filter((step) => step.status === "completed").length;
  const active = item.status === "streaming";

  return (
    <article
      aria-label="执行计划"
      className="execution-plan-card"
      data-status={item.status}
    >
      <header className="execution-plan-card__header">
        <div>
          <span className="execution-plan-card__label">
            {active ? "执行计划更新中" : "执行计划"}
          </span>
          <strong>
            {completed}/{item.steps.length} 已完成
          </strong>
        </div>
        <span
          aria-label={`${completed} / ${item.steps.length} 个步骤已完成`}
          className="execution-plan-card__progress"
        >
          <span
            style={{
              width: `${item.steps.length === 0 ? 0 : (completed / item.steps.length) * 100}%`,
            }}
          />
        </span>
      </header>

      {item.explanation ? (
        <p className="execution-plan-card__explanation">{item.explanation}</p>
      ) : null}

      <ol className="execution-plan-card__steps">
        {item.steps.map((step) => (
          <ExecutionPlanStepView key={step.step} step={step} />
        ))}
      </ol>
    </article>
  );
}

function ExecutionPlanStepView({
  step,
}: {
  step: ExecutionPlanStep;
}): React.ReactNode {
  const label =
    step.status === "completed"
      ? "已完成"
      : step.status === "in_progress"
        ? "进行中"
        : "待处理";

  return (
    <li data-status={step.status}>
      <span className="execution-plan-card__step-icon" aria-hidden="true">
        {step.status === "completed" ? (
          <Check />
        ) : step.status === "in_progress" ? (
          <LoaderCircle className="canonical-spin" />
        ) : (
          <Circle />
        )}
      </span>
      <span>{step.step}</span>
      <small>{label}</small>
    </li>
  );
}
