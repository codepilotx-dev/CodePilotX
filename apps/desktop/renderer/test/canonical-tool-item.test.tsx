import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Item } from "@codepilotx/shared/thread";

import {
  buildLifecycleToolDisplay,
  buildStructuredToolDetail,
  buildToolItemDisplay,
  buildToolSemanticSummary,
  fileMutationDisplay,
  FileMutationItemView,
  formatToolDuration,
  isStandaloneLifecycleTool,
  LifecycleToolItemView,
  syntheticPatchDisplay,
  ToolItemView,
  ToolExecutionCard,
} from "../src/features/session/timeline/CanonicalItemRenderer.js";
import { TooltipProvider } from "../src/components/ui/Tooltip.js";

type ToolItem = Extract<Item, { type: "tool" }>;

function toolItem(overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    id: "tool-1",
    messageID: "message-1",
    turnId: "turn-1",
    agentId: "agent-1",
    type: "tool",
    callID: "call-1",
    tool: "Bash",
    title: "运行命令",
    state: "completed",
    input: null,
    command: "bun test",
    output: "pass",
    error: null,
    startedAt: 1_000,
    finishedAt: 1_250,
    durationMs: 250,
    createdAt: 1_000,
    ...overrides,
  };
}

describe("canonical tool item display", () => {
  test("formats command durations independently from semantic summaries", () => {
    expect(formatToolDuration(250)).toBe("1 秒");
    expect(formatToolDuration(84_000)).toBe("1 分 24 秒");
    expect(buildToolItemDisplay(toolItem()).expandedLabel).toBe("Ran command");
  });

  test("only allows an active command to expand after output arrives", () => {
    expect(buildToolItemDisplay(toolItem({
      state: "running",
      durationMs: null,
      finishedAt: null,
      output: "   ",
    })).canExpand).toBe(false);
    expect(buildToolItemDisplay(toolItem({
      state: "running",
      durationMs: null,
      finishedAt: null,
      output: "partial output",
    }))).toMatchObject({
      canExpand: true,
      collapsedLabel: "Running bun test",
      expandedLabel: "Running command",
      resultText: "partial output",
    });
  });

  test("uses semantic state labels for structured tools without exposing tool names", () => {
    const scenarios = [
      ["Read", { file_path: "src/ConversationPage.tsx" }, "正在读取 src/ConversationPage.tsx", "已读取 src/ConversationPage.tsx"],
      ["workspace.Grep", { pattern: "canRegenerate" }, "正在搜索 canRegenerate", "已搜索 canRegenerate"],
      ["Glob", { pattern: "**/*.tsx" }, "正在查找 **/*.tsx", "已查找 **/*.tsx"],
      ["ToolSearch", {}, "正在搜索工具", "已搜索工具"],
      ["update_plan", {}, "正在更新计划", "已更新计划"],
      ["skill_read", { name: "reverse-engineer-ui-feature" }, "正在读取技能 reverse-engineer-ui-feature", "已读取技能 reverse-engineer-ui-feature"],
    ] as const;

    for (const [tool, input, runningLabel, completedLabel] of scenarios) {
      const running = buildToolSemanticSummary(toolItem({
        command: null,
        input,
        state: "running",
        tool,
      }));
      const completed = buildToolSemanticSummary(toolItem({
        command: null,
        input,
        tool,
      }));
      expect(running.collapsedLabel).toBe(runningLabel);
      expect(completed.collapsedLabel).toBe(completedLabel);
    }

    expect(buildToolSemanticSummary(toolItem({
      command: null,
      input: { secret: "do-not-render" },
      state: "error",
      tool: "internal.private_tool",
    }))).toMatchObject({
      collapsedLabel: "操作失败",
      toolLabel: "操作",
    });
  });

  test("uses state-specific failure and interruption labels", () => {
    expect(buildToolSemanticSummary(toolItem({
      state: "error",
    })).collapsedLabel).toBe("Command failed bun test");
    expect(buildToolSemanticSummary(toolItem({
      state: "interrupted",
    })).collapsedLabel).toBe("Command interrupted bun test");
    expect(buildToolSemanticSummary(toolItem({
      command: null,
      input: { file_path: "C:\\private\\ConversationPage.tsx" },
      state: "interrupted",
      tool: "Read",
    })).collapsedLabel).toBe("已中断读取 ConversationPage.tsx");
    expect(buildToolItemDisplay(toolItem({
      command: null,
      input: { file_path: "C:\\private\\ConversationPage.tsx" },
      tool: "Read",
    })).executionContent).not.toContain("C:\\private");
  });

  test("projects structured tool inputs and outputs into focused details", () => {
    expect(buildStructuredToolDetail(toolItem({
      command: null,
      input: { file_path: "src/ConversationPage.tsx", limit: 20 },
      output: JSON.stringify({
        content: "const conversation = true;\n",
        lineCount: 1,
        path: "src/ConversationPage.tsx",
      }),
      tool: "Read",
    }))).toEqual({
      executionContent: "src/ConversationPage.tsx",
      resultText: "const conversation = true;\n",
    });
    expect(buildStructuredToolDetail(toolItem({
      command: null,
      input: { pattern: "canRegenerate", path: "apps" },
      output: JSON.stringify({
        files: ["src/a.ts", "C:\\private\\src\\b.ts"],
        engine: "ripgrep",
      }),
      tool: "Grep",
    }))).toEqual({
      executionContent: "canRegenerate",
      resultText: JSON.stringify(["src/a.ts", "b.ts"], null, 2),
    });
    expect(buildStructuredToolDetail(toolItem({
      command: null,
      input: { pattern: "needle" },
      output: JSON.stringify({
        matches: [{
          path: "C:\\private\\src\\secret.ts",
          line: 4,
          text: "const needle = true;",
          internal: "do-not-render",
        }],
      }),
      tool: "Grep",
    }))?.resultText).toBe(JSON.stringify([{
      path: "secret.ts",
      line: 4,
      text: "const needle = true;",
    }], null, 2));
    expect(buildStructuredToolDetail(toolItem({
      command: null,
      input: { pattern: "**/*.tsx" },
      output: JSON.stringify({ matches: ["src/a.tsx"] }),
      tool: "Glob",
    }))).toEqual({
      executionContent: "**/*.tsx",
      resultText: JSON.stringify(["src/a.tsx"], null, 2),
    });
    expect(buildStructuredToolDetail(toolItem({
      command: null,
      input: { query: "select:apply_patch" },
      output: JSON.stringify({ tools: [{ name: "apply_patch" }] }),
      tool: "tool.search",
    }))).toEqual({
      executionContent: "select:apply_patch",
      resultText: JSON.stringify([{ name: "apply_patch" }], null, 2),
    });
    expect(buildStructuredToolDetail(toolItem({
      command: null,
      input: { name: "reverse-engineer-ui-feature" },
      output: JSON.stringify({ content: "# Skill\n完整内容" }),
      tool: "skill_read",
    }))).toEqual({
      executionContent: "reverse-engineer-ui-feature",
      resultText: "# Skill\n完整内容",
    });
  });

  test("does not fall back to whole JSON for missing structured fields", () => {
    const missing = buildStructuredToolDetail(toolItem({
      command: null,
      input: { pattern: "needle", secret: "do-not-render" },
      output: JSON.stringify({ engine: "ripgrep", secret: "do-not-render" }),
      tool: "Grep",
    }));
    expect(missing).toEqual({
      executionContent: "needle",
      resultText: null,
    });
    expect(buildToolItemDisplay(toolItem({
      command: null,
      input: { pattern: "needle", secret: "do-not-render" },
      output: JSON.stringify({ engine: "ripgrep", secret: "do-not-render" }),
      tool: "Grep",
    })).resultText).toBeNull();

    expect(buildStructuredToolDetail(toolItem({
      command: null,
      error: "读取失败",
      input: {},
      output: "安全的非 JSON 输出",
      tool: "Read",
    }))).toEqual({
      executionContent: "未提供文件路径",
      resultText: "安全的非 JSON 输出\n读取失败",
    });
  });

  test("renders lifecycle tools as non-expandable live status rows", () => {
    const scenarios = [
      ["update_plan", "正在更新计划", "已更新计划", "更新计划", "lucide-notepad-text"],
      ["request_permissions", "正在请求权限", "已请求权限", "请求权限", "lucide-shield"],
      ["request_user_input", "正在等待回答", "已获得回答", "提问", "lucide-message-circle-question"],
      ["spawn_agents", "正在创建子代理", "已创建子代理", "创建子代理", "lucide-user-round-plus"],
      ["wait_agents", "正在等待子代理", "子代理已返回", "等待子代理", "lucide-hourglass"],
      ["send_agent", "正在通知子代理", "已通知子代理", "通知子代理", "lucide-send"],
      ["stop_agent", "正在停止子代理", "已停止子代理", "停止子代理", "lucide-circle-stop"],
      ["finalize_result", "正在提交子代理结果", "已提交子代理结果", "提交子代理结果", "lucide-clipboard-check"],
    ] as const;

    for (const [tool, runningLabel, completedLabel, toolLabel, iconClass] of scenarios) {
      const running = toolItem({
        command: null,
        input: {},
        output: null,
        state: "running",
        tool,
      });
      const completed = toolItem({
        command: null,
        input: {},
        output: "{}",
        tool,
      });
      expect(buildLifecycleToolDisplay(running)).toMatchObject({
        active: true,
        label: runningLabel,
        toolLabel,
      });
      expect(buildLifecycleToolDisplay(completed)).toMatchObject({
        active: false,
        label: completedLabel,
        toolLabel,
      });
      expect(buildToolItemDisplay(completed)).toMatchObject({
        canExpand: false,
        collapsedLabel: completedLabel,
        resultText: null,
        toolLabel,
      });
      expect(isStandaloneLifecycleTool(completed)).toBe(true);

      const runningMarkup = renderToStaticMarkup(
        <LifecycleToolItemView item={running} />,
      );
      const completedMarkup = renderToStaticMarkup(
        <LifecycleToolItemView item={completed} />,
      );
      const failedMarkup = renderToStaticMarkup(
        <LifecycleToolItemView item={toolItem({
          command: null,
          error: "failed",
          input: {},
          output: null,
          state: "error",
          tool,
        })} />,
      );

      expect(runningMarkup).toContain(iconClass);
      expect(runningMarkup).toContain("canonical-lifecycle-tool__icon-flash");
      expect(runningMarkup).not.toContain("lucide-loader-circle");
      expect(completedMarkup).toContain(iconClass);
      expect(completedMarkup).not.toContain("canonical-lifecycle-tool__icon-flash");
      expect(completedMarkup).not.toContain("lucide-check");
      expect(failedMarkup).toContain("lucide-circle-alert");
      expect(failedMarkup).not.toContain(iconClass);
    }

    const interruptedMarkup = renderToStaticMarkup(
      <LifecycleToolItemView item={toolItem({
        command: null,
        input: {},
        output: null,
        state: "interrupted",
        tool: "update_plan",
      })} />,
    );
    expect(interruptedMarkup).toContain('class="canonical-lifecycle-tool"');
    expect(interruptedMarkup).toContain("已中断更新计划");
    expect(interruptedMarkup).toContain("lucide-circle-alert");
    expect(interruptedMarkup).not.toContain("lucide-notepad-text");
    expect(interruptedMarkup).not.toContain("<details");
    expect(interruptedMarkup).not.toContain("lucide-chevron");
  });

  test("combines output and error without leaking apply-patch input", () => {
    const result = buildToolItemDisplay(toolItem({
      tool: "workspace.apply_patch",
      title: "应用补丁",
      command: null,
      input: {
        patch: "*** Update File: C:\\secret\\source.ts\n-old\n+new",
        patchBytes: 42,
      },
      output: "partial",
      error: "failed",
    }));

    expect(result.resultText).toBe("partial\nfailed");
    expect(result.executionContent).toContain("[补丁正文已隐藏]");
    expect(result.executionContent).not.toContain("C:\\secret");
  });

  test("renders separate copy actions and omits result copy for empty output", () => {
    const withResultItem = toolItem({ output: "pass", error: "warning" });
    const withResult = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard
          item={withResultItem}
          view={buildToolItemDisplay(withResultItem)}
        />
      </TooltipProvider>,
    );
    const withoutResultItem = toolItem({ output: null, error: null });
    const withoutResult = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard
          item={withoutResultItem}
          view={buildToolItemDisplay(withoutResultItem)}
        />
      </TooltipProvider>,
    );

    expect(withResult).toContain('aria-label="复制执行内容"');
    expect(withResult).toContain('aria-label="复制返回结果"');
    expect(withResult).toContain("pass\nwarning");
    expect(withoutResult).toContain('aria-label="复制执行内容"');
    expect(withoutResult).not.toContain('aria-label="复制返回结果"');
    expect(withoutResult).toContain("无输出");
  });

  test("uses the persisted disclosure state for command details", () => {
    const item = toolItem();
    const collapsed = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: "tool:turn-1:tool-1",
            expanded: false,
            onExpandedChange: () => undefined,
          }}
          item={item}
        />
      </TooltipProvider>,
    );
    const expanded = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: "tool:turn-1:tool-1",
            expanded: true,
            onExpandedChange: () => undefined,
          }}
          item={item}
        />
      </TooltipProvider>,
    );

    expect(collapsed).toContain("Ran bun test");
    expect(collapsed).not.toContain('aria-label="执行内容"');
    expect(collapsed).toContain("lucide-chevron-right");
    expect(collapsed).not.toContain("lucide-chevron-down");
    expect(expanded).toContain("Ran command");
    expect(expanded).toContain('aria-label="执行内容"');
    expect(expanded).toContain("lucide-chevron-down");
    expect(expanded).not.toContain("lucide-chevron-right");
  });

  test("extracts file mutations and renders one row per affected file", () => {
    const item = toolItem({
      command: null,
      input: {
        additions: 3,
        affectedPaths: [
          { path: "src/a.ts", operation: "update" },
          { path: "src/b.ts", operation: "create", additions: 2, deletions: 0 },
        ],
        deletions: 1,
      },
      output: null,
      tool: "workspace.apply_patch",
    });
    const mutation = fileMutationDisplay(item);
    expect(mutation).toMatchObject({
      files: [
        { additions: null, deletions: null, path: "src/a.ts" },
        { additions: 2, deletions: 0, path: "src/b.ts" },
      ],
      totalAdditions: 3,
      totalDeletions: 1,
    });

    const markup = renderToStaticMarkup(<FileMutationItemView item={item} />);
    expect(markup).toContain("已编辑 src/a.ts");
    expect(markup).toContain("已编辑 src/b.ts");
    expect(markup).toContain("+2");
    expect(markup).not.toContain("+0</small><small");
  });

  test("builds a terminal fallback patch from successful mutation tools only", () => {
    const completed = toolItem({
      command: null,
      id: "mutation-1",
      input: { additions: 3, deletions: 1, file_path: "src/a.ts" },
      output: null,
      tool: "Write",
    });
    const failed = toolItem({
      command: null,
      id: "mutation-2",
      input: { additions: 10, deletions: 10, path: "src/b.ts" },
      output: null,
      state: "error",
      tool: "Edit",
    });
    expect(syntheticPatchDisplay([completed, failed])).toMatchObject({
      files: [{ additions: 3, deletions: 1, path: "src/a.ts" }],
      totalAdditions: 3,
      totalDeletions: 1,
    });
  });
});
