import React from "react";
import { Circle, CircleCheck, LoaderCircle } from "lucide-react";
import type { Item } from "@codepilotx/shared/thread";

type ExecutionPlanItem = Extract<Item, { type: "execution-plan" }>;
type ExecutionPlanStep = ExecutionPlanItem["steps"][number];

export function ExecutionPlanCard({
  item,
}: {
  item: ExecutionPlanItem;
}): React.ReactNode {
  return (
    <article
      aria-label="执行计划"
      className="execution-plan-card"
      data-status={item.status}
    >
      <ol className="execution-plan-card__steps">
        {item.steps.map((step, index) => (
          <ExecutionPlanStepView
            index={index}
            key={`${index}:${step.step}`}
            step={step}
          />
        ))}
      </ol>
    </article>
  );
}

function ExecutionPlanStepView({
  index,
  step,
}: {
  index: number;
  step: ExecutionPlanStep;
}): React.ReactNode {
  const label =
    step.status === "completed"
      ? "已完成"
      : step.status === "in_progress"
        ? "进行中"
        : "待处理";

  return (
    <li
      aria-label={`第 ${index + 1} 步，${step.step}，${label}`}
      data-status={step.status}
    >
      <span className="execution-plan-card__step-icon" aria-hidden="true">
        {step.status === "completed" ? (
          <CircleCheck />
        ) : step.status === "in_progress" ? (
          <LoaderCircle className="canonical-spin" />
        ) : (
          <Circle />
        )}
      </span>
      <span className="execution-plan-card__step-index" aria-hidden="true">
        {index + 1}.
      </span>
      <span className="execution-plan-card__step-text">{step.step}</span>
    </li>
  );
}
