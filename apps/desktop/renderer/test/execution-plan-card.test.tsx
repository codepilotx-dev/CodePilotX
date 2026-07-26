import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExecutionPlanItem } from "@codepilotx/shared/thread";

import {
  ComposerChangeSummary,
  executionPlanStepPosition,
  findLatestExecutionPlan,
} from "../src/features/session/composer/ComposerChangeSummary";
import { ExecutionPlanCard } from "../src/features/session/workflow/ExecutionPlanCard";

describe("ExecutionPlanCard", () => {
  test("shows the compact current-turn checklist without the former card chrome", () => {
    const item = executionPlanItem();

    const html = renderToStaticMarkup(<ExecutionPlanCard item={item} />);

    expect(html).toContain("更新协议");
    expect(html).toContain("接入时间线");
    expect(html).toContain("运行验证");
    expect(html).toContain("lucide-circle-check");
    expect(html).toContain("lucide-loader-circle");
    expect(html).toContain("lucide-circle");
    expect(html).toContain("execution-plan-card__step-index");
    expect(html).toContain(">1.</span>");
    expect(html).toContain(">2.</span>");
    expect(html).toContain(">3.</span>");
    expect(html).not.toContain("execution-plan-card__header");
    expect(html).not.toContain("先完成协议，再接入界面。");
    expect(html).not.toContain("<small");
    expect(html).not.toContain("<button");
  });

  test("derives the current one-based step with lifecycle fallbacks", () => {
    expect(executionPlanStepPosition(executionPlanItem())).toBe(2);
    expect(
      executionPlanStepPosition(
        executionPlanItem({
          status: "completed",
          steps: [
            { step: "更新协议", status: "completed" },
            { step: "接入界面", status: "completed" },
          ],
        }),
      ),
    ).toBe(2);
    expect(
      executionPlanStepPosition(
        executionPlanItem({
          steps: [
            { step: "更新协议", status: "completed" },
            { step: "接入界面", status: "pending" },
          ],
        }),
      ),
    ).toBe(2);
    expect(
      executionPlanStepPosition(executionPlanItem({ steps: [] })),
    ).toBe(0);
  });

  test("keeps the most recent execution plan across retry turns", () => {
    const plan = executionPlanItem({ status: "interrupted" });

    expect(
      findLatestExecutionPlan([
        { executionPlanItems: [plan] },
        { executionPlanItems: [] },
        { executionPlanItems: [] },
      ]),
    ).toBe(plan);
    expect(
      findLatestExecutionPlan([
        { executionPlanItems: [plan] },
        {
          executionPlanItems: [
            executionPlanItem({
              id: "turn-2:execution-plan",
              turnId: "turn-2",
            }),
          ],
        },
      ])?.turnId,
    ).toBe("turn-2");
  });

  test("combines plan progress and file changes with status-aware icons", () => {
    const streamingHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active
        additions={279}
        changedFileCount={5}
        deletions={155}
        executionPlan={executionPlanItem({ status: "interrupted" })}
      />,
    );
    const completedHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={0}
        changedFileCount={0}
        deletions={0}
        executionPlan={executionPlanItem({ status: "completed" })}
      />,
    );
    const interruptedHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={0}
        changedFileCount={0}
        deletions={0}
        executionPlan={executionPlanItem({ status: "interrupted" })}
      />,
    );
    const fileOnlyHtml = renderToStaticMarkup(
      <ComposerChangeSummary
        active={false}
        additions={12}
        changedFileCount={1}
        deletions={3}
        executionPlan={null}
      />,
    );

    expect(streamingHtml).toContain("第 2 / 3 步");
    expect(streamingHtml).toContain("5 个文件已更改");
    expect(streamingHtml).toContain("+279");
    expect(streamingHtml).toContain("-155");
    expect(streamingHtml).toContain("composer-change-summary__diff");
    expect(streamingHtml).toContain("composer-change-summary__separator");
    expect(streamingHtml).toContain('aria-label="执行计划进行中"');
    expect(streamingHtml).toContain("<button");
    expect(streamingHtml).toContain("ui-button");
    expect(streamingHtml).toContain('aria-expanded="false"');
    expect(streamingHtml).toContain("aria-controls=");
    expect(streamingHtml).toContain('aria-hidden="true"');
    expect(streamingHtml).toContain("hidden=");
    expect(streamingHtml).not.toContain("composer-change-summary__chevron");
    expect(completedHtml).toContain('aria-label="执行计划已完成"');
    expect(completedHtml).not.toContain("composer-change-summary__separator");
    expect(interruptedHtml).toContain('aria-label="执行计划已中断"');
    expect(fileOnlyHtml).toContain("1 个文件已更改");
    expect(fileOnlyHtml).not.toContain("<button");
    expect(fileOnlyHtml).not.toContain("composer-change-summary__separator");
    expect(fileOnlyHtml).toContain("composer-change-summary__diff");
  });
});

function executionPlanItem(
  overrides: Partial<ExecutionPlanItem> = {},
): ExecutionPlanItem {
  return {
    id: "turn-1:execution-plan",
    messageID: "turn-1",
    turnId: "turn-1",
    agentId: "agent-1",
    type: "execution-plan",
    explanation: "先完成协议，再接入界面。",
    steps: [
      { step: "更新协议", status: "completed" },
      { step: "接入时间线", status: "in_progress" },
      { step: "运行验证", status: "pending" },
    ],
    status: "streaming",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}
