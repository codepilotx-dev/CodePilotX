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
import { AttachmentFilePill } from "../src/features/session/attachments/AttachmentRowPrimitives.js";
import { threadPatchDiffToDesktopFile } from "../src/features/session/timeline/FileMutationDiffContent.js";
import {
  createThreadPatchDiffLoader,
  ExpandableFileMutationRow,
} from "../src/features/session/timeline/ExpandableFileMutationRow.js";
import { ConversationItemContext } from "../src/features/session/timeline/ConversationItemContext.js";
import { createKeyedDisclosureStore } from "../src/components/ui/keyedDisclosureStore.js";

type ToolItem = Extract<Item, { type: "tool" }>;

function disclosureStore(...expandedKeys: string[]) {
  return createKeyedDisclosureStore({ initialExpandedKeys: expandedKeys });
}

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
    activity: { type: "command", kind: "test" },
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
  test("keeps file attachment pills independent from action button geometry", () => {
    const markup = renderToStaticMarkup(
      <AttachmentFilePill
        detail="text/plain · 42 B"
        name="notes.txt"
        onOpen={() => undefined}
      />,
    );

    expect(markup).toContain('<button aria-label="打开 notes.txt" class="attachment-file-pill__open" type="button">');
    expect(markup).not.toMatch(/class="[^"]*attachment-file-pill__open[^"]*ui-button/);
  });

  test("formats command durations independently from semantic summaries", () => {
    expect(formatToolDuration(250)).toBe("1 秒");
    expect(formatToolDuration(84_000)).toBe("1 分 24 秒");
    expect(buildToolItemDisplay(toolItem()).expandedLabel).toBe("已在 1 秒内执行 bun test");
    expect(buildToolSemanticSummary(toolItem({
      activity: undefined,
    })).collapsedLabel).toBe("已在 1 秒内执行 bun test");
    expect(buildToolSemanticSummary(toolItem({
      durationMs: null,
      finishedAt: null,
    })).collapsedLabel).toBe("已执行 bun test");
    expect(buildToolSemanticSummary(toolItem({
      durationMs: null,
      finishedAt: null,
      state: "running",
    }), { nowMs: 2_500 }).collapsedLabel).toBe("正在执行 bun test · 2 秒");
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
      collapsedLabel: "正在执行 bun test",
      expandedLabel: "正在执行 bun test",
      resultText: "partial output",
    });
  });

  test("uses shared descriptors for activity labels and icons", () => {
    const scenarios = [
      [{ type: "read", subject: "file", target: { displayLabel: "src/ConversationPage.tsx", workspacePath: "src/ConversationPage.tsx" } }, "正在读取 src/ConversationPage.tsx", "已读取 src/ConversationPage.tsx", "read"],
      [{ type: "search", query: "canRegenerate" }, "正在搜索“canRegenerate”", "已搜索“canRegenerate”", "search"],
      [{ type: "list_files" }, "正在列出文件", "已列出文件", "list-files"],
      [{ type: "tool", mode: "search" }, "正在搜索工具", "已搜索工具", "tool"],
      [{ type: "tool", mode: "load", name: "browser.open" }, "正在加载工具 browser.open", "已加载工具 browser.open", "skill"],
      [{ type: "read", subject: "skill", target: { displayLabel: "reverse-engineer-ui-feature" } }, "正在读取 reverse-engineer-ui-feature 技能", "已读取 reverse-engineer-ui-feature 技能", "skill"],
      [{ type: "web_search" }, "正在搜索网页", "已搜索网页", "web-search"],
      [{ type: "integration", source: "github" }, "正在使用 github", "已使用 github", "integration"],
      [{ type: "command", kind: "skill_script", skillName: "review", scriptName: "check.py" }, "正在执行 review 技能中的脚本 check.py", "已在 1 秒内执行 review 技能中的脚本 check.py", "command"],
      [{ type: "command", kind: "current_time" }, "正在检查当前日期和时间", "已检查当前日期和时间 · 1 秒", "current-time"],
    ] as const;

    for (const [activity, runningLabel, completedLabel, iconKind] of scenarios) {
      const running = buildToolSemanticSummary(toolItem({
        command: null,
        activity,
        state: "running",
      }));
      const completed = buildToolSemanticSummary(toolItem({
        command: null,
        activity,
      }));
      expect(running.collapsedLabel).toBe(runningLabel);
      expect(completed.collapsedLabel).toBe(completedLabel);
      expect(completed.iconKind).toBe(iconKind);
    }

    expect(buildToolSemanticSummary(toolItem({
      activity: undefined,
      command: null,
      input: { secret: "do-not-render" },
      state: "error",
      tool: "internal.private_tool",
    }))).toMatchObject({
      collapsedLabel: "工具调用失败 internal.private_tool",
      toolLabel: "工具",
    });

    expect(buildToolSemanticSummary(toolItem()).kind).toBe("command");
    expect(buildToolSemanticSummary(toolItem({
      activity: { type: "read", subject: "file", target: { displayLabel: "src/a.ts" } },
      command: null,
      tool: "Read",
    })).kind).toBe("exploration");
    expect(buildToolSemanticSummary(toolItem({
      activity: { type: "web_search" },
      command: null,
      tool: "web__run",
    })).kind).toBe("web-search");
    expect(buildToolSemanticSummary(toolItem({
      activity: { type: "integration", source: "drive" },
      command: null,
      tool: "mcp__drive__search",
    })).kind).toBe("integration");
    expect(buildToolSemanticSummary(toolItem({
      activity: { type: "tool", mode: "call" },
      command: null,
      tool: "internal.private_tool",
    })).kind).toBe("tool");
  });

  test("uses state-specific failure and interruption labels", () => {
    expect(buildToolSemanticSummary(toolItem({
      state: "error",
    })).collapsedLabel).toBe("执行失败 bun test · 1 秒");
    expect(buildToolSemanticSummary(toolItem({
      state: "interrupted",
    })).collapsedLabel).toBe("已停止执行 bun test · 1 秒");
    expect(buildToolSemanticSummary(toolItem({
      activity: { type: "read", subject: "file", target: { displayLabel: "ConversationPage.tsx" } },
      command: null,
      input: { file_path: "C:\\private\\ConversationPage.tsx" },
      state: "interrupted",
      tool: "Read",
    })).collapsedLabel).toBe("已停止读取 ConversationPage.tsx");
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

  test("renders workspace targets as isolated file links", () => {
    const linked = renderToStaticMarkup(
      <TooltipProvider>
        <ConversationItemContext.Provider value={{
          canCopyFileReferenceContents: () => false,
          onCopyFileReferenceContents: () => undefined,
          onOpenFileReference: () => undefined,
          onSubmitEditedUserMessage: async () => undefined,
          sessionStatus: "idle",
          workspacePath: "C:\\workspace",
        }}>
          <ToolItemView item={toolItem({
            activity: {
              type: "read",
              subject: "file",
              target: { displayLabel: "src/a.ts", workspacePath: "src/a.ts" },
            },
            command: null,
            tool: "Read",
          })} />
        </ConversationItemContext.Provider>
      </TooltipProvider>,
    );
    const displayOnly = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView item={toolItem({
          activity: { type: "read", subject: "file", target: { displayLabel: "external.ts" } },
          command: null,
          tool: "Read",
        })} />
      </TooltipProvider>,
    );

    expect(linked).toContain('class="cpx-agent-activity__file-link"');
    expect(linked).toContain('aria-label="打开文件 src/a.ts"');
    expect(displayOnly).not.toContain("cpx-agent-activity__file-link");
  });

  test("renders grouped commands as embedded shells without losing details", () => {
    const item = toolItem({ output: "pass" });
    const embedded = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard
          item={item}
          presentation="grouped"
          view={buildToolItemDisplay(item)}
        />
      </TooltipProvider>,
    );
    const standalone = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard
          item={item}
          view={buildToolItemDisplay(item)}
        />
      </TooltipProvider>,
    );
    const groupedItem = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: "tool:turn-1:tool-1",
            expanded: true,
            onExpandedChange: () => undefined,
          }}
          item={item}
          presentation="grouped"
        />
      </TooltipProvider>,
    );

    expect(embedded).toContain("canonical-command-shell--embedded");
    expect(embedded).not.toContain("canonical-command-shell__header");
    expect(embedded).toContain('aria-label="复制执行内容"');
    expect(embedded).toContain('aria-label="复制返回结果"');
    expect(embedded).toContain("bun test");
    expect(embedded).toContain("pass");
    expect(embedded).toContain("成功");
    expect(standalone).not.toContain("canonical-command-shell--embedded");
    expect(standalone).toContain("canonical-command-shell__header");
    expect(groupedItem).toContain('data-presentation="grouped"');
    expect(groupedItem).toContain("canonical-command-shell--embedded");
  });

  test("keeps the controlled disclosure mode for command details", () => {
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

    expect(collapsed).toContain("已在 1 秒内执行 bun test");
    expect(collapsed).toContain('aria-label="执行内容"');
    expect(collapsed).toContain('data-mount-policy="always"');
    expect(collapsed).toContain('aria-hidden="true"');
    expect(collapsed).toContain("inert");
    expect(collapsed).toContain("lucide-chevron-right");
    expect(collapsed).not.toContain("lucide-chevron-down");
    expect(expanded).toContain("已在 1 秒内执行 bun test");
    expect(expanded).toContain('aria-label="执行内容"');
    expect(expanded).toContain("lucide-chevron-right");
    expect(expanded).not.toContain("lucide-chevron-down");
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
    expect(markup).toContain("已创建 src/b.ts");
    expect(markup).toContain("+2");
    expect(markup).not.toContain("+0</small><small");
  });

  test("only exposes completed file mutations backed by diff evidence", () => {
    const completed = toolItem({
      command: null,
      input: { additions: 1, deletions: 0, file_path: "src/a.ts" },
      mutationDiffPaths: ["src\\a.ts"],
      output: null,
      tool: "Edit",
    });
    const expandableMarkup = renderToStaticMarkup(
      <ExpandableFileMutationRow
        diffMarkerStyle="color"
        disclosure={{
          id: "file-mutation:tool-1:0",
          store: disclosureStore("file-mutation:tool-1:0"),
        }}
        file={{ additions: 1, deletions: 0, path: "src/a.ts" }}
        item={completed}
        readThreadPatchDiff={async () => {
          throw new Error("not called during server render");
        }}
        threadId="thread-1"
      />,
    );
    const legacyMarkup = renderToStaticMarkup(
      <FileMutationItemView item={{ ...completed, mutationDiffPaths: undefined }} />,
    );
    const runningMarkup = renderToStaticMarkup(
      <FileMutationItemView
        disclosureStore={disclosureStore("file-mutation:tool-1:0")}
        item={{ ...completed, state: "running" }}
        readThreadPatchDiff={async () => {
          throw new Error("not called during server render");
        }}
        threadId="thread-1"
      />,
    );

    expect(expandableMarkup).toContain('data-expandable="true"');
    expect(expandableMarkup).toContain("lucide-chevron-right");
    expect(expandableMarkup).toContain("正在加载差异");
    expect(legacyMarkup).toContain("cpx-agent-activity__item-header--static");
    expect(legacyMarkup).not.toContain("<details");
    expect(legacyMarkup).not.toContain("<summary");
    expect(legacyMarkup).not.toContain("lucide-chevron");
    expect(runningMarkup).not.toContain("<details");
    expect(runningMarkup).not.toContain("lucide-chevron");
  });

  test("loads a thread patch with exact params and reuses a successful result", async () => {
    const calls: unknown[] = [];
    let resolveRequest!: (value: Awaited<ReturnType<Parameters<typeof createThreadPatchDiffLoader>[0]>>) => void;
    const result = {
      path: "src/a.ts",
      operation: "update" as const,
      patch: "",
      hunks: [],
      renderable: true,
      tooLargeReason: null,
    };
    const loader = createThreadPatchDiffLoader((params) => {
      calls.push(params);
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    });
    const states: string[] = [];
    loader.request(
      "thread-1:call-1:src/a.ts",
      { threadId: "thread-1", toolCallId: "call-1", path: "src/a.ts" },
      (state) => states.push(state.status),
    );
    expect(calls).toEqual([
      { threadId: "thread-1", toolCallId: "call-1", path: "src/a.ts" },
    ]);
    resolveRequest(result);
    await Promise.resolve();
    await Promise.resolve();
    loader.request(
      "thread-1:call-1:src/a.ts",
      { threadId: "thread-1", toolCallId: "call-1", path: "src/a.ts" },
      (state) => states.push(state.status),
    );
    expect(calls).toHaveLength(1);
    expect(states).toEqual(["loading", "loaded", "loaded"]);
  });

  test("ignores a patch response after its consumer is disposed", async () => {
    let resolveRequest!: (value: {
      path: string;
      operation: "update";
      patch: string;
      hunks: [];
      renderable: true;
      tooLargeReason: null;
    }) => void;
    const loader = createThreadPatchDiffLoader(() =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const states: string[] = [];
    const dispose = loader.request(
      "thread-1:call-1:src/a.ts",
      { threadId: "thread-1", toolCallId: "call-1", path: "src/a.ts" },
      (state) => states.push(state.status),
    );
    dispose();
    resolveRequest({
      path: "src/a.ts",
      operation: "update",
      patch: "",
      hunks: [],
      renderable: true,
      tooLargeReason: null,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual(["loading"]);
  });

  test("adapts a thread patch diff to the shared review line model", () => {
    const file = threadPatchDiffToDesktopFile({
      path: "src/a.ts",
      operation: "update",
      patch: [
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,2 @@",
        "-old",
        "+new",
        " context",
        "",
      ].join("\n"),
      hunks: [{
        id: "hunk-1",
        header: "@@ -1,2 +1,2 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        patch: "@@ -1,2 +1,2 @@\n-old\n+new\n context",
      }],
      renderable: true,
      tooLargeReason: null,
    });

    expect(file).toMatchObject({
      path: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
    });
    expect(file.hunks[0]?.lines).toEqual([
      expect.objectContaining({ type: "removed", oldLine: 1, newLine: null, content: "old" }),
      expect.objectContaining({ type: "added", oldLine: null, newLine: 1, content: "new" }),
      expect.objectContaining({ type: "context", oldLine: 2, newLine: 2, content: "context" }),
    ]);
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

  test("renders text, citation, JSON and artifact result blocks without API name branches", () => {
    const item = toolItem({
      command: null,
      input: null,
      output: "结论",
      resultBlocks: [
        { type: "text", text: "结论" },
        { type: "citation", title: "示例来源", url: "https://example.com/source" },
        { type: "citation", url: "https://example.com/bare" },
        { type: "citation", url: "file:///etc/passwd" },
        { type: "json", value: { items: [{ id: 1, ok: true }] } },
        { type: "artifact", artifactId: "artifact:1", name: "preview.png", mimeType: "image/png", size: 1024 },
        { type: "artifact", artifactId: "artifact:2", name: "notes.txt", mimeType: "text/plain", size: 42 },
      ],
    });
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    );

    expect(markup).toContain("canonical-tool-result-blocks");
    expect(markup).toContain("canonical-tool-result-block--text");
    expect(markup).toContain("结论");
    // citation: 安全可点击链接仅放行 http/https，且标题优先。
    expect(markup).toContain('href="https://example.com/source"');
    expect(markup).toContain("示例来源");
    expect(markup).toContain('href="https://example.com/bare"');
    // 非 http/https 的 citation 渲染为纯文本，不生成可点击链接。
    expect(markup).not.toContain('href="file:///etc/passwd"');
    // json: 结构化展示不按工具名分支。
    expect(markup).toContain("canonical-tool-result-block--json");
    expect(markup).toContain("&quot;ok&quot;: true");
    // artifact: 图片走预览 tile，其他类型走通用文件 pill。
    expect(markup).toContain("attachment-image-tile");
    expect(markup).toContain("preview.png");
    expect(markup).toContain("attachment-file-pill");
    expect(markup).toContain("notes.txt");
  });

  test("renders a single legacy text block when resultBlocks are absent", () => {
    const item = toolItem({ command: null, input: null, output: "旧字符串结果" });
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    );
    expect(markup).not.toContain("canonical-tool-result-blocks");
    expect(markup).toContain("旧字符串结果");
    expect(markup).toContain('aria-label="复制返回结果"');
  });
});
