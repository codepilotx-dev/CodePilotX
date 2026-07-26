import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExecutionPlanItem } from "@codepilotx/shared/thread";

import { ExecutionPlanCard } from "../src/features/session/workflow/ExecutionPlanCard";

describe("ExecutionPlanCard", () => {
  test("shows the current turn checklist without interactive actions", () => {
    const item: ExecutionPlanItem = {
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
    };

    const html = renderToStaticMarkup(<ExecutionPlanCard item={item} />);

    expect(html).toContain("执行计划更新中");
    expect(html).toContain("1/3 已完成");
    expect(html).toContain("先完成协议，再接入界面。");
    expect(html).toContain("接入时间线");
    expect(html).not.toContain("<button");
  });
});
