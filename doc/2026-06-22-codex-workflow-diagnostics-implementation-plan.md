# Codex Workflow Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Codex-style workflow diagnostics, tool result failure visibility, and lifecycle foundations while keeping the current TypeScript/Bun runtime.

**Architecture:** Keep `QueryEngine + query()` as the model loop and strengthen the Codex-style projection layer around it. Improve renderer Markdown diagnostics first, then stabilize SDK-to-workflow metadata, then add contract/lifecycle/profile foundations in small independently tested commits.

**Tech Stack:** TypeScript, TSX, Bun tests, Electron desktop renderer/main, existing `ThreadEvent` / `TurnItem` workflow model.

## Global Constraints

- Read and write project files as UTF-8.
- Save implementation plans under `D:\VueProject\ClaudeCode\doc` before changing code.
- Use Chinese commit messages.
- Commit after each completed task.
- Keep imports using existing `.js` extension style.
- Do not edit generated files by hand.
- Do not treat `workflow-events.jsonl` as resume authority.
- Do not replace `QueryEngine`, `query()`, transcript recovery, or tool execution order in this plan.
- Preserve existing public exports and runtime behavior unless a task explicitly adds an internal helper.
- Existing unrelated dirty files must not be reverted or included in commits.

---

## File Structure

- `apps/desktop/src/renderer/features/session/workflowMarkdown.ts`
  - Formats workflow diagnostics and Markdown export.
  - Will rename the misleading consistency label and render missing-turn details.
- `apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`
  - Tests Markdown output, failed tool metadata rendering, and detailed turn lifecycle diagnostics.
- `apps/desktop/src/renderer/features/session/workflowConsistency.ts`
  - Derives consistency diagnostics from workflow events and session messages.
  - Will add structured missing-turn detail while keeping a compatibility list for counts.
- `apps/desktop/src/renderer/features/session/workflowConsistency.test.ts`
  - Tests missing-turn detail derivation and existing diagnostic counts.
- `apps/desktop/src/renderer/components/ConversationPage.tsx`
  - Displays consistency summary in the desktop UI.
  - Will update user-facing wording only.
- `apps/tui/src/workflow/sdkEventMapping.ts`
  - Projects SDK messages into `ThreadEvent`.
  - Will make failed `tool_result` metadata extraction more robust without changing schema.
- `apps/tui/src/workflow/sdkEventMapping.test.ts`
  - Tests failed result metadata extraction from structured result, block content, nested content arrays, and common error fields.
- `packages/core/src/agent/workflow.ts`
  - Defines core workflow types and normalization helpers.
  - Later task may add fixture helpers if no suitable helper exists.
- `packages/core/src/agent/workflow.test.ts`
  - Tests workflow event contract fixtures and valid event chains.
- `apps/tui/src/workflow/ThreadRuntime.ts`
  - Thread facade around current runtime.
  - Later task adds internal `resumeThread`, `forkThread`, `rollbackTurn`, and `injectItem`.
- `apps/tui/src/workflow/ThreadRuntime.test.ts`
  - Tests lifecycle APIs without changing transcript or model loop behavior.
- `packages/core/src/agent/permissions.ts`
  - Existing permissions model.
  - Later task adds a small session/thread permission profile mapping layer only if it can be done without disturbing current checks.
- `packages/core/src/agent/permissions.test.ts`
  - Tests permission profile mapping compatibility.

---

### Task 1: Rename Misleading Consistency Diagnostic

**Files:**
- Modify: `apps/desktop/src/renderer/features/session/workflowMarkdown.ts`
- Modify: `apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`
- Modify: `apps/desktop/src/renderer/components/ConversationPage.tsx`

**Interfaces:**
- Consumes: `WorkflowConsistencyDiagnostics.missingTurnCompletions: string[]`
- Produces: User-facing wording `缺 turn 终止事件` instead of `缺 terminal`.

- [ ] **Step 1: Write failing tests**

In `apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`, update the consistency diagnostic expectation to require:

```ts
expect(markdown).toContain(
  '- 一致性诊断: 6 个（缺 turn 终止事件 1，未配对 call 1，孤立 result 1，未决权限 1，最终回复不一致 1，混入 thread 1）',
)
expect(markdown).not.toContain('缺 terminal')
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
bun test apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
```

Expected: FAIL because output still contains `缺 terminal`.

- [ ] **Step 3: Implement minimal wording change**

Change `workflowMarkdown.ts` summary formatter from:

```ts
`缺 terminal ${diagnostics.missingTurnCompletions.length}`
```

to:

```ts
`缺 turn 终止事件 ${diagnostics.missingTurnCompletions.length}`
```

Change `ConversationPage.tsx` consistency summary label from:

```tsx
<span>缺 terminal {diagnostics.missingTurnCompletions.length}</span>
```

to:

```tsx
<span>缺 turn 终止事件 {diagnostics.missingTurnCompletions.length}</span>
```

- [ ] **Step 4: Verify**

Run:

```powershell
bun test apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/features/session/workflowMarkdown.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts apps/desktop/src/renderer/components/ConversationPage.tsx
git commit -m "修正 Workflow 一致性诊断文案"
```

---

### Task 2: Add Missing Turn Lifecycle Detail

**Files:**
- Modify: `apps/desktop/src/renderer/features/session/workflowConsistency.ts`
- Modify: `apps/desktop/src/renderer/features/session/workflowConsistency.test.ts`
- Modify: `apps/desktop/src/renderer/features/session/workflowMarkdown.ts`
- Modify: `apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`

**Interfaces:**
- Consumes: `DesktopWorkflowEvent[]`
- Produces:

```ts
export type WorkflowMissingTurnCompletion = {
  turnId: string
  lastEventType: string
  lastEventCreatedAt: string
  likelyStillRunning: boolean
}
```

and `WorkflowConsistencyDiagnostics.missingTurnCompletionDetails: WorkflowMissingTurnCompletion[]`.

- [ ] **Step 1: Write failing consistency test**

In `workflowConsistency.test.ts`, add a test where a turn has `turn.started` and `item.completed` but no terminal turn event:

```ts
expect(diagnostics.missingTurnCompletions).toEqual(['turn-1'])
expect(diagnostics.missingTurnCompletionDetails).toEqual([
  {
    turnId: 'turn-1',
    lastEventType: 'item.completed',
    lastEventCreatedAt: '2026-06-22T00:00:03.000Z',
    likelyStillRunning: true,
  },
])
```

- [ ] **Step 2: Run failing consistency test**

Run:

```powershell
bun test apps/desktop/src/renderer/features/session/workflowConsistency.test.ts
```

Expected: FAIL because `missingTurnCompletionDetails` does not exist.

- [ ] **Step 3: Implement diagnostic detail derivation**

Add the exported type above and extend `WorkflowConsistencyDiagnostics`.

Implement helper:

```ts
function findMissingTurnCompletionDetails(
  events: DesktopWorkflowEvent[],
): WorkflowMissingTurnCompletion[] {
  const missing = new Set(findMissingTurnCompletions(events))
  return [...missing].map(turnId => {
    const turnEvents = events.filter(
      event => 'turnId' in event && event.turnId === turnId,
    )
    const lastEvent = turnEvents[turnEvents.length - 1]
    return {
      turnId,
      lastEventType: lastEvent?.type ?? 'unknown',
      lastEventCreatedAt: lastEvent?.createdAt ?? '',
      likelyStillRunning: Boolean(lastEvent),
    }
  })
}
```

Return it from `deriveWorkflowConsistencyDiagnostics`.

- [ ] **Step 4: Write failing Markdown detail test**

In `workflowMarkdown.test.ts`, add a report with one `missingTurnCompletionDetails` entry and assert it contains:

```md
## 缺 turn 终止事件

| turn | 最后事件 | 最后时间 | 判断 |
| --- | --- | --- | --- |
| turn-1 | item.completed | 2026/6/22 ... | 可能仍在运行或复制过早 |
```

Use `expect(markdown).toContain('turn-1')`, `item.completed`, and `可能仍在运行或复制过早` instead of depending on locale-specific full time.

- [ ] **Step 5: Run failing Markdown test**

Run:

```powershell
bun test apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
```

Expected: FAIL because the detail section is not rendered.

- [ ] **Step 6: Implement Markdown detail section**

In `buildWorkflowMarkdownReport`, after the summary lines and before the event table, add a section when `consistencyDiagnostics.missingTurnCompletionDetails.length > 0`.

Render columns:

- `turn`
- `最后事件`
- `最后时间`
- `判断`

Use `formatWorkflowTime(detail.lastEventCreatedAt)` for time and `可能仍在运行或复制过早` when `likelyStillRunning` is true.

- [ ] **Step 7: Verify**

Run:

```powershell
bun test apps/desktop/src/renderer/features/session/workflowConsistency.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/desktop/src/renderer/features/session/workflowConsistency.ts apps/desktop/src/renderer/features/session/workflowConsistency.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
git commit -m "细化 Workflow turn 生命周期诊断"
```

---

### Task 3: Stabilize Failed Tool Result Metadata

**Files:**
- Modify: `apps/tui/src/workflow/sdkEventMapping.ts`
- Modify: `apps/tui/src/workflow/sdkEventMapping.test.ts`
- Modify: `apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`

**Interfaces:**
- Consumes: SDK user messages with `tool_result` blocks and optional `tool_use_result`.
- Produces: `ToolResultTurnItem.metadata` with readable `stderr`, `stdout`, `output`, `error`, `message`, `text`, `content`, and `result` when available.

- [ ] **Step 1: Write failing SDK metadata test**

Add a test where `tool_use_result` contains nested arrays and objects:

```ts
tool_use_result: {
  error: { message: 'Read failed' },
  output: [{ text: 'No such file' }],
}
```

Expected metadata:

```ts
metadata: {
  error: 'message=Read failed',
  output: 'No such file',
  content: 'Read',
}
```

- [ ] **Step 2: Run failing SDK test**

Run:

```powershell
bun test apps/tui/src/workflow/sdkEventMapping.test.ts
```

Expected: FAIL because nested object text is not normalized consistently.

- [ ] **Step 3: Implement robust metadata text extraction**

Update `toolResultMetadata()` to call a helper that can extract text from:

- strings
- arrays of strings or records with `text` / `content` / `message`
- records with `text`, `content`, `message`, `error`, `stderr`, `stdout`, or `output`
- fallback JSON for records with no readable text

Keep schema unchanged and keep `metadata.result = message.tool_use_result`.

- [ ] **Step 4: Verify SDK mapping**

Run:

```powershell
bun test apps/tui/src/workflow/sdkEventMapping.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify Markdown still expands metadata**

Run:

```powershell
bun test apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/tui/src/workflow/sdkEventMapping.ts apps/tui/src/workflow/sdkEventMapping.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
git commit -m "补齐工具失败结果详情映射"
```

---

### Task 4: Lock Workflow Event Contract Fixtures

**Files:**
- Modify: `packages/core/src/agent/workflow.ts`
- Modify: `packages/core/src/agent/workflow.test.ts`

**Interfaces:**
- Produces test fixtures for the minimal legal event chain:
  - `thread.started`
  - `turn.started`
  - `item.started | item.updated | item.completed`
  - `turn.completed | turn.failed | turn.interrupted`

- [ ] **Step 1: Write failing contract tests**

Add tests that assert fixtures cover tool, permission, file change, and error items, with stable `schemaVersion`, `eventId`, `sequence`, `threadId`, `turnId`, item `id`, and `createdAt`.

- [ ] **Step 2: Run failing core workflow tests**

Run:

```powershell
bun test packages/core/src/agent/workflow.test.ts
```

Expected: FAIL if fixture helpers do not exist or event chain coverage is missing.

- [ ] **Step 3: Add minimal fixture helper or inline fixtures**

Prefer inline fixtures in tests if production helper is unnecessary. Add production exports only if multiple tests need shared construction.

- [ ] **Step 4: Verify**

Run:

```powershell
bun test packages/core/src/agent/workflow.test.ts apps/tui/src/workflow/sdkEventMapping.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/core/src/agent/workflow.ts packages/core/src/agent/workflow.test.ts
git commit -m "固化 Workflow 事件契约测试"
```

---

### Task 5: Add Internal ThreadRuntime Lifecycle APIs

**Files:**
- Modify: `apps/tui/src/workflow/ThreadRuntime.ts`
- Modify: `apps/tui/src/workflow/ThreadRuntime.test.ts`

**Interfaces:**
- Produces internal methods:
  - `resumeThread(threadId, snapshotOrState)`
  - `forkThread(sourceThreadId, options)`
  - `rollbackTurn(threadId, turnId)`
  - `injectItem(threadId, turnId, item)`

- [ ] **Step 1: Write failing lifecycle tests**

Add tests proving each method updates facade state and emits `ThreadEvent` without changing transcript or calling the model loop.

- [ ] **Step 2: Run failing runtime tests**

Run:

```powershell
bun test apps/tui/src/workflow/ThreadRuntime.test.ts
```

Expected: FAIL because methods do not exist or events are missing.

- [ ] **Step 3: Implement minimal internal lifecycle methods**

Keep the APIs internal to `ThreadRuntime`. Do not expose desktop UI controls in this task.

- [ ] **Step 4: Verify**

Run:

```powershell
bun test apps/tui/src/workflow/ThreadRuntime.test.ts packages/core/src/agent/workflow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/tui/src/workflow/ThreadRuntime.ts apps/tui/src/workflow/ThreadRuntime.test.ts
git commit -m "补齐 ThreadRuntime 生命周期接口"
```

---

### Task 6: Add Permission Profile Mapping Layer

**Files:**
- Modify: `packages/core/src/agent/permissions.ts`
- Modify: `packages/core/src/agent/permissions.test.ts`

**Interfaces:**
- Produces a small mapping layer from existing approval/permission settings into a session/thread `permission profile`.
- Keeps current `canUseTool`, hook permission decision, permission drawer, and tool-level overrides compatible.

- [ ] **Step 1: Inspect current dirty permission changes**

Run:

```powershell
git diff -- packages/core/src/agent/permissions.ts packages/core/src/agent/permissions.test.ts
```

Expected: Identify existing user changes and avoid reverting them.

- [ ] **Step 2: Write failing profile mapping tests**

Add tests for:

- default profile maps to existing permission behavior
- per-tool override wins over profile default
- approval mode and sandbox scope are preserved in profile shape

- [ ] **Step 3: Run failing permission tests**

Run:

```powershell
bun test packages/core/src/agent/permissions.test.ts
```

Expected: FAIL because profile mapping does not exist.

- [ ] **Step 4: Implement minimal mapping layer**

Do not rewrite existing permission checks. Add a typed helper and adapt existing logic only where required by tests.

- [ ] **Step 5: Verify**

Run:

```powershell
bun test packages/core/src/agent/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/core/src/agent/permissions.ts packages/core/src/agent/permissions.test.ts
git commit -m "引入 Codex 风格权限配置映射"
```

---

## Final Verification

- [ ] Run focused workflow tests:

```powershell
bun test packages/core/src/agent/workflow.test.ts apps/tui/src/workflow/sdkEventMapping.test.ts apps/tui/src/workflow/ThreadRuntime.test.ts apps/desktop/src/renderer/features/session/workflowConsistency.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts
```

- [ ] Run desktop typecheck:

```powershell
bun run desktop:typecheck
```

- [ ] If the changes touch core permission behavior, also run:

```powershell
bun test packages/core/src/agent/permissions.test.ts
```

## Self-Review

- Spec coverage: all requested high-priority items map to Tasks 1-3; medium-priority Codex foundations map to Tasks 4-6.
- Placeholder scan: no `TBD` or `TODO` placeholders are used.
- Type consistency: `WorkflowMissingTurnCompletion` is introduced before Markdown consumes it; `missingTurnCompletions` remains available for existing count code.
