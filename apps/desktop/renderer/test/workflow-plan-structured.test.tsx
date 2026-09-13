import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructuredPlan } from "@codepilotx/shared/thread";

import {
  StructuredPlanView,
  WorkflowPlanCard,
  createPlanDockRequest,
  planTitleFromSummary,
} from "../src/features/session/workflow/WorkflowPlanCard";
import {
  getWorkbenchTabDefinition,
  type WorkbenchTabRenderContext,
} from "../src/features/layout/tabs/workbenchTabRegistry";

const structuredPlan = (overrides: Partial<StructuredPlan> = {}): StructuredPlan => ({
  title: "结构化计划交付",
  summary: "把最终方案升级为 submit_plan 提交。",
  changes: [
    { area: "共享契约", items: ["新增 StructuredPlanSchema", "派生 Markdown"] },
    { area: "桌面展示", items: ["按章节渲染"] },
  ],
  interfaceChanges: ["新增 plan.structured.v1 capability"],
  tests: ["Agent 聚焦测试"],
  assumptions: [],
  ...overrides,
});

const renderCard = (structured?: StructuredPlan) =>
  renderToStaticMarkup(
    <WorkflowPlanCard
      eventId="turn-1:plan"
      summary={"# 历史方案\n\n旧 Markdown 正文"}
      structured={structured}
      streaming={false}
      isDocked={false}
      onOpenInRightDock={() => undefined}
    />,
  );

describe("WorkflowPlanCard structured plans", () => {
  test("按固定语义顺序渲染结构化章节并隐藏空章节", () => {
    const html = renderCard(structuredPlan());

    expect(html).toContain("结构化计划交付");
    expect(html).toContain("把最终方案升级为 submit_plan 提交。");
    expect(html).toContain("实现变更");
    expect(html).toContain("共享契约");
    expect(html).toContain("新增 StructuredPlanSchema");
    expect(html).toContain("桌面展示");
    expect(html).toContain("接口变化");
    expect(html).toContain("新增 plan.structured.v1 capability");
    expect(html).toContain("测试");
    expect(html).toContain("Agent 聚焦测试");
    // 空的假设章节不渲染，也不回退到历史 Markdown。
    expect(html).not.toContain("假设");
    expect(html).not.toContain("旧 Markdown 正文");

    const order = ["实现变更", "接口变化", "测试"].map((heading) => html.indexOf(heading));
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  test("Markdown 历史计划继续原样展示", () => {
    const html = renderCard();
    expect(html).toContain("历史方案");
    expect(html).toContain("旧 Markdown 正文");
    expect(html).not.toContain("workflow-plan-structured");
  });

  test("docked 模式使用结构化标题，且标题解析兼容派生 Markdown", () => {
    const docked = renderToStaticMarkup(
      <WorkflowPlanCard
        eventId="turn-1:plan"
        summary="# 派生标题"
        structured={structuredPlan()}
        streaming={false}
        isDocked
        onOpenInRightDock={() => undefined}
      />,
    );
    expect(docked).toContain("结构化计划交付");
    expect(planTitleFromSummary("# 派生标题")).toBe("派生标题");
  });

  test("结构化视图只渲染内容，不引入自由组件或样式入口", () => {
    const html = renderToStaticMarkup(<StructuredPlanView plan={structuredPlan()} />);
    expect(html).toContain("workflow-plan-structured__list");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  test("右侧计划标签优先渲染打开时携带的正文", () => {
    const tab = {
      id: "plan:turn-1:plan",
      kind: "plan",
      eventId: "turn-1:plan",
      title: "结构化计划交付",
      content: "# 结构化计划交付\n\n右侧计划正文",
    } as const;
    const definition = getWorkbenchTabDefinition(tab);
    const html = renderToStaticMarkup(definition.render(tab, {
      planContentByEventId: {},
    } as unknown as WorkbenchTabRenderContext));

    expect(html).toContain("右侧计划正文");
    expect(html).not.toContain("暂无计划");
  });

  test("计划未生成完成时不可在右侧打开，也不渲染打开入口", () => {
    const streaming = renderToStaticMarkup(
      <WorkflowPlanCard
        eventId="turn-2:plan"
        summary="# 正在写的计划"
        streaming
        isDocked={false}
        onOpenInRightDock={() => undefined}
      />,
    );
    expect(streaming).not.toContain("在右侧打开计划");
    expect(streaming).toContain("编写计划");

    // 打开请求本身携带可打开性，供唯一的打开入口拒绝半成品快照。
    expect(createPlanDockRequest({
      eventId: "turn-2:plan",
      title: "正在写的计划",
      content: "# 正在写的计划",
      streaming: true,
    })).toMatchObject({ openable: false });
    expect(createPlanDockRequest({
      eventId: "turn-2:plan",
      title: "计划",
      content: "# 计划",
      streaming: false,
    })).toMatchObject({ openable: true });

    const completed = renderCard(structuredPlan());
    expect(completed).toContain("在右侧打开计划");
  });
});
