# Composer 状态弹层与命令去重 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Composer 的 `+` 菜单中激活「状态」条目，点击后弹出全宽状态弹层（会话/上下文/配额）；同时增加 `commandName` 去重机制消除 slash command 与本地入口的视觉重复。

**Architecture:** 新增 `providerBalanceUtils.ts` 提取格式函数供 `SidebarFooter` 和状态弹层共用；在 `ComposerCard.tsx` 的 `unifiedMenuItems` 构建中加入 `commandName` 去重；新增 `ComposerStatusOverlay.tsx` 组件，复用 `ChatInputDropdown` 容器。

**Tech Stack:** TypeScript/TSX, React, Lucide icons, Vitest (bun test), ComposerCard + ChatInputDropdown

## Global Constraints

- 所有 import 保持 `.js` 扩展名风格
- 不修改 `DESKTOP_PRIMARY_SLASH_COMMANDS` 或 `listSlashCommands`（主进程）
- 不新增全局路由或状态页
- 不改动 TUI `/status` 命令行为
- 状态弹层仅查询当前所选提供商配额，不汇总多提供商
- 运行 `bun run desktop:typecheck` 和 `bun run desktop:css:check` 验证

---

### Task 1: 提取公共工具模块 `providerBalanceUtils`

**Files:**
- Create: `apps/desktop/src/renderer/utils/providerBalanceUtils.ts`
- Create: `apps/desktop/src/renderer/utils/providerBalanceUtils.test.ts`
- Modify: `apps/desktop/src/renderer/features/layout/sidebar/SidebarFooter.tsx`

**Interfaces:**
- Produces:
  - `formatRemainingWindow(remainingTime: number | null, endTime: number | null): string`
  - `formatDuration(milliseconds: number): string`
  - `clampPercent(value: number): number`

- [ ] **Step 1: 创建 `providerBalanceUtils.test.ts` 并写入失败测试**

```typescript
import { describe, it, expect } from 'bun:test'
import { formatRemainingWindow, formatDuration, clampPercent } from './providerBalanceUtils.js'

describe('clampPercent', () => {
  it('clamps values within 0-100', () => {
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(-10)).toBe(0)
    expect(clampPercent(75)).toBe(75)
  })
  it('handles NaN', () => {
    expect(clampPercent(NaN)).toBe(0)
  })
  it('rounds to nearest integer', () => {
    expect(clampPercent(75.6)).toBe(76)
    expect(clampPercent(75.4)).toBe(75)
  })
})

describe('formatDuration', () => {
  it('formats minutes', () => {
    expect(formatDuration(120_000)).toBe('2 分钟')
    expect(formatDuration(60_000)).toBe('1 分钟')
  })
  it('formats hours and minutes', () => {
    // 90 minutes = 1h30m
    expect(formatDuration(5_400_000)).toBe('1 小时 30 分')
  })
  it('formats whole hours', () => {
    expect(formatDuration(7_200_000)).toBe('2 小时')
  })
  it('minimum 1 minute', () => {
    expect(formatDuration(1000)).toBe('1 分钟')
  })
})

describe('formatRemainingWindow', () => {
  it('formats remaining time when available', () => {
    // 30 minutes
    expect(formatRemainingWindow(1_800_000, null)).toBe('30 分钟')
  })
  it('formats end date when no remaining time', () => {
    const endTime = new Date('2026-07-15T00:00:00Z').getTime()
    const result = formatRemainingWindow(null, endTime)
    expect(result).toContain('7月')
    expect(result).toContain('15')
  })
  it('returns em-dash when no data', () => {
    expect(formatRemainingWindow(null, null)).toBe('—')
  })
  it('ignores zero/negative remaining time', () => {
    expect(formatRemainingWindow(0, 1_000_000)).toBe(formatRemainingWindow(null, 1_000_000))
    expect(formatRemainingWindow(-1, null)).toBe('—')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun test apps/desktop/src/renderer/utils/providerBalanceUtils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 `providerBalanceUtils.ts`**

```typescript
export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60000))
  if (totalMinutes < 60) return `${totalMinutes} 分钟`
  const hours = Math.floor(totalMinutes / 60)
  const restMinutes = totalMinutes % 60
  return restMinutes
    ? `${hours} 小时 ${restMinutes} 分`
    : `${hours} 小时`
}

export function formatRemainingWindow(
  remainingTime: number | null,
  endTime: number | null,
): string {
  if (remainingTime != null && remainingTime > 0) {
    return formatDuration(remainingTime)
  }
  if (endTime != null && endTime > 0) {
    return new Date(endTime).toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
    })
  }
  return '—'
}

export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun test apps/desktop/src/renderer/utils/providerBalanceUtils.test.ts`
Expected: PASS (all 10+ tests)

- [ ] **Step 5: 更新 `SidebarFooter.tsx` 改为导入公共模块**

将顶部的局部函数替换为导入：

```typescript
// SidebarFooter.tsx 顶部已有导入块，加入：
import { formatRemainingWindow, formatDuration, clampPercent } from '../../../utils/providerBalanceUtils.js'
```

删除文件中以下三个局部函数：
- `clampPercent`（约第 352-355 行）
- `formatRemainingWindow`（约第 357-371 行）
- `formatDuration`（约第 373-381 行）

确认 SidebarFooter 中其他代码（`buildMiniMaxRows` 调用的 `clampPercent`、`formatRemainingWindow`）保持不变。

- [ ] **Step 6: 运行 SidebarFooter 相关测试验证**

Run: 查找是否有 sidebar footer 测试 `bun test apps/desktop/src/renderer/features/layout/sidebar/`
如果无具体测试，至少验证编译：`bun run desktop:typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/utils/providerBalanceUtils.ts apps/desktop/src/renderer/utils/providerBalanceUtils.test.ts apps/desktop/src/renderer/features/layout/sidebar/SidebarFooter.tsx
git commit -m "refactor(desktop): extract provider balance utilities to shared module"
```

---

### Task 2: 添加 `commandName` 去重机制

**Files:**
- Modify: `apps/desktop/src/renderer/features/session/ComposerCard.tsx`

**Interfaces:**
- Consumes: `UnifiedMenuItem` 类型（已有）
- Produces: 添加 `commandName` 字段 + 去重后的 `unifiedMenuItems`

- [ ] **Step 1: 给 `UnifiedMenuItem` 增加 `commandName` 字段**

在 `ComposerCard.tsx` 的 `UnifiedMenuItem` 类型定义中（约第 166-180 行），在 `icon` 和 `matchText` 之间添加：

```typescript
  /** Optional slash command name for dedup. Local entries declare ownership. */
  commandName?: string;
```

- [ ] **Step 2: 为本地入口声明 `commandName`**

在 `unifiedMenuItems` 构建中，逐个添加 `commandName`：

- `推理` (key `reasoning`, 约第 491 行): `commandName: "effort"`
- `模型` (key `model`, 约第 510 行): `commandName: "model"`
- `状态` (key `status`, 约第 519 行): `commandName: "status"`
- `目标` (key `goal-mode`, 约第 542 行): `commandName: "goal"`
- `计划模式` (key `plan-mode`, 约第 555 行): `commandName: "plan"`
- `记忆` (key `memory`, 约第 529 行): `commandName: "remember"`

`新工作树` (key `worktree`, 约第 501 行): 不声明 `commandName`（不属于 slash command）

例如 `推理` 条目变为：

```typescript
{
  group: "添加",
  key: "reasoning",
  commandName: "effort",
  label: "推理",
  // ... rest unchanged
}
```

其余类似。

- [ ] **Step 3: 添加去重逻辑替换 `planGoalNames` 硬编码排除**

将现有的（约第 622 行）：
```typescript
const planGoalNames = new Set(["plan", "goal"]);
for (const cmd of slashCommands ?? []) {
  if (cmd.category === "skill") {
    // ... skills
  } else if (cmd.category === "command" && !planGoalNames.has(cmd.name)) {
    // ... commands
  }
}
```

替换为：

```typescript
// Collect command names owned by local entries + reserved names
const ownedCommandNames = new Set<string>()
for (const item of items) {
  if (item.commandName) ownedCommandNames.add(item.commandName)
}
ownedCommandNames.add('branch') // reserved — exclude dynamic "派生"

for (const cmd of slashCommands ?? []) {
  if (ownedCommandNames.has(cmd.name)) continue
  if (cmd.category === "skill") {
    // ... skills (contents unchanged)
    items.push({ ... })
  } else if (cmd.category === "command") {
    // ... commands (remove the `!planGoalNames.has(cmd.name)` check)
    items.push({ ... })
  }
}
```

注意：`items` 在此时已经包含了所有本地条目（包括声明了 `commandName` 的），所以 `ownedCommandNames` 的收集需要在循环之前、本地条目 push 完成之后。

实际上，当前的代码结构是：本地条目用一个个 `items.push(...)` 添加，然后才开始遍历 `slashCommands`。所以 `ownedCommandNames` 的收集放在第一个 slash command 处理之前即可。

- [ ] **Step 4: 验证类型检查**

Run: `bun run desktop:typecheck`
Expected: 0 errors

- [ ] **Step 5: 验证去重逻辑——运行 ComposerCard 测试**

Run: `bun test apps/desktop/src/renderer/features/session/ComposerCard.test.tsx`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/features/session/ComposerCard.tsx
git commit -m "feat(desktop): deduplicate slash commands by commandName in composer menu"
```

---

### Task 3: 创建 `ComposerStatusOverlay` 组件

**Files:**
- Create: `apps/desktop/src/renderer/features/session/ComposerStatusOverlay.tsx`
- Create: `apps/desktop/src/renderer/features/session/ComposerStatusOverlay.test.tsx`
- Modify: `apps/desktop/src/renderer/styles/features/composer.scss`（新增样式）

**Interfaces:**
- Consumes: `open`, `onClose`, `routedSessionId`, `contextUsage`, `selectedProviderID`, `side` props
- Produces: `ComposerStatusOverlay` 组件
- Consumes API: `desktopClient.fetchProviderBalance({ providerID })`

- [ ] **Step 1: 创建 `ComposerStatusOverlay.test.tsx`——写入基础渲染测试**

```typescript
import { describe, it, expect } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { ComposerStatusOverlay } from './ComposerStatusOverlay.js'
import type { DesktopContextUsage } from '../../../shared/types.js'

describe('ComposerStatusOverlay', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ComposerStatusOverlay
        open={false}
        onClose={() => {}}
        routedSessionId="sess-123"
        contextUsage={null}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders session ID when open', () => {
    render(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId="sess-abc-123"
        contextUsage={null}
      />
    )
    expect(screen.getByText('状态')).toBeTruthy()
    expect(screen.getByText('sess-abc-123')).toBeTruthy()
  })

  it('shows fallback when no session ID', () => {
    render(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId={null}
        contextUsage={null}
      />
    )
    expect(screen.getByText('尚未创建会话')).toBeTruthy()
  })

  it('shows context usage data when available', () => {
    const contextUsage: DesktopContextUsage = {
      model: 'gpt-4',
      contextWindow: 128000,
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      reasoningTokens: 0,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 0,
      usedTokens: 1500,
      remainingTokens: 126500,
      usedPercent: 1.17,
      remainingPercent: 98.83,
    }
    render(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId="sess-1"
        contextUsage={contextUsage}
      />
    )
    expect(screen.getByText('上下文用量')).toBeTruthy()
    expect(screen.getByText('1,500 / 128,000')).toBeTruthy()
  })

  it('shows no-context placeholder when null', () => {
    render(
      <ComposerStatusOverlay
        open={true}
        onClose={() => {}}
        routedSessionId="sess-1"
        contextUsage={null}
      />
    )
    expect(screen.getByText('暂无上下文统计')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun test apps/desktop/src/renderer/features/session/ComposerStatusOverlay.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 `ComposerStatusOverlay.tsx` 骨架**

Skeleton with minimal render — just enough to pass "renders nothing when closed":

```typescript
import type React from 'react'
import { ChatInputDropdown } from './ChatInputDropdown.js'

type Props = {
  open: boolean
  onClose: () => void
  routedSessionId: string | null
  contextUsage: DesktopContextUsage | null
  selectedProviderID?: ModelProviderID
  side?: 'top' | 'bottom'
}

export function ComposerStatusOverlay({
  open,
  onClose,
  routedSessionId,
  contextUsage,
  selectedProviderID,
  side = 'top',
}: Props): React.ReactNode {
  if (!open) return null

  return (
    <ChatInputDropdown open={open} onClose={onClose} side={side} width="100%" maxWidth="100%">
      <div className="composer-status-content">
        status
      </div>
    </ChatInputDropdown>
  )
}
```

然后运行测试验证失败 → 逐步实现完整功能。

- [ ] **Step 3b: 实现 Session ID 行**

在 `routedSessionId` 为 null 时显示「尚未创建会话」，否则显示 ID。

- [ ] **Step 3c: 实现上下文用量区**

接收 `contextUsage` prop，显示进度条、`usedTokens` / `contextWindow` 格式化数字。
使用 `Intl.NumberFormat` 格式化 token 数字（如 `1,500 / 128,000`）。
当 `contextUsage` 为 null 时显示「暂无上下文统计」。

- [ ] **Step 3d: 实现提供商配额区（骨架版——没有实际 fetch）**

在有 `selectedProviderID` 时显示配额区（暂时只显示静态 UI 框架），使用 `useState` + `useEffect` 在打开时调用 `fetchProviderBalance`。

- [ ] **Step 3e: 运行测试验证通过**

Run: `bun test apps/desktop/src/renderer/features/session/ComposerStatusOverlay.test.tsx`
Expected: PASS

- [ ] **Step 4: 实现完整的提供商配额获取逻辑**

在 `ComposerStatusOverlay` 内部：

```typescript
const [balance, setBalance] = useState<DesktopProviderBalanceResult | null>(null)
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
  if (!open || !selectedProviderID) return
  let cancelled = false
  setLoading(true)
  setError(null)
  setBalance(null)
  
  if (!isBillingProviderID(selectedProviderID)) {
    setLoading(false)
    return
  }
  
  desktopClient.fetchProviderBalance({ providerID: selectedProviderID })
    .then(result => {
      if (!cancelled) {
        setBalance(result)
        setLoading(false)
        setError(result.error ?? null)
      }
    })
    .catch(err => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })
  
  return () => { cancelled = true }
}, [open, selectedProviderID])
```

需要 import：
- `isBillingProviderID` from `../../utils/billingProviders.js`
- `desktopClient` from `../../services/desktopClient.js`
- `clampPercent`, `formatRemainingWindow` from `../../utils/providerBalanceUtils.js`
- Types: `DesktopProviderBalanceResult`, `DesktopProviderTokenPlanUsageInfo`, `ModelProviderID` from `../../../shared/types.js`

- [ ] **Step 5: 完整实现渲染——所有区段**

完整的 JSX 布局（在 `ChatInputDropdown` 的 children 内）：

```typescript
<div className="composer-status-content">
  {/* Header */}
  <div className="composer-status-header">
    <span className="composer-status-title">状态</span>
    <button className="composer-status-close" onClick={onClose} type="button" aria-label="关闭">
      <X size={14} />
    </button>
  </div>

  {/* Session ID */}
  <div className="composer-status-section">
    <div className="composer-status-label">会话 ID</div>
    <div className="composer-status-value">
      {routedSessionId ?? '尚未创建会话'}
    </div>
  </div>

  {/* Context Usage */}
  <div className="composer-status-section">
    <div className="composer-status-label">上下文用量</div>
    {contextUsage ? (
      <>
        <div className="composer-status-bar-track">
          <div
            className="composer-status-bar-fill"
            style={{ '--usage-ratio': contextUsage.usedPercent / 100 } as React.CSSProperties}
          />
        </div>
        <div className="composer-status-bar-meta">
          <span className="composer-status-bar-percent">
            {Math.round(contextUsage.usedPercent)}%
          </span>
          <span className="composer-status-bar-detail">
            {contextUsage.usedTokens.toLocaleString()} / {contextUsage.contextWindow.toLocaleString()}
          </span>
        </div>
      </>
    ) : (
      <div className="composer-status-empty">暂无上下文统计</div>
    )}
  </div>

  {/* Quota section */}
  {selectedProviderID ? (
    <div className="composer-status-section">
      {loading ? (
        <div className="composer-status-empty">正在查询用量…</div>
      ) : error ? (
        <div className="composer-status-empty composer-status-empty-error">{error}</div>
      ) : balance?.tokenPlanUsages?.length ? (
        balance.tokenPlanUsages.map(usage => (
          <div key={usage.modelName}>
            {renderQuotaRow('5 小时限额', usage.currentIntervalRemainingPercent, usage.currentIntervalRemainingCount, usage.currentIntervalEndTime)}
            {usage.currentWeeklyRemainingPercent != null
              ? renderQuotaRow('7 天限额', usage.currentWeeklyRemainingPercent, usage.currentWeeklyRemainingCount, usage.weeklyEndTime)
              : null}
          </div>
        ))
      ) : (
        <div className="composer-status-empty">当前提供商未返回用量数据</div>
      )}
    </div>
  ) : null}
</div>
```

辅助渲染函数 `renderQuotaRow`：

```typescript
function renderQuotaRow(
  label: string,
  percent: number | null,
  remainingCount: number | null,
  endTime: number | null,
): React.ReactNode {
  return (
    <div className="composer-status-quota-row">
      <div className="composer-status-label">{label}</div>
      <div className="composer-status-bar-track">
        <div
          className="composer-status-bar-fill"
          style={{ '--usage-ratio': clampPercent(percent ?? 0) / 100 } as React.CSSProperties}
        />
      </div>
      <div className="composer-status-bar-meta">
        <span className="composer-status-bar-percent">{clampPercent(percent ?? 0)}%</span>
        <span className="composer-status-bar-detail">
          {remainingCount != null ? `剩余 ${remainingCount.toLocaleString()} tokens` : ''}
          {endTime != null ? ` · ${formatRemainingWindow(null, endTime)}` : ''}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 在 `composer.scss` 中添加状态弹层样式**

在文件末尾、`/* --- Chat input dropdown --- */` 段落之后新增：

```scss
/* --- Composer status overlay --- */
.composer-status-content {
  padding: 0;
}

.composer-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  border-bottom: 1px solid var(--color-popover-divider);
}

.composer-status-title {
  font-weight: var(--font-weight-heading, 560);
  font-size: var(--font-size-14);
}

.composer-status-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: var(--radius-sm);
  color: var(--color-icon);

  &:hover {
    background: var(--color-hover-bg);
  }
}

.composer-status-section {
  padding: 10px 16px;
}

.composer-status-section + .composer-status-section {
  border-top: 1px solid var(--color-popover-divider);
}

.composer-status-label {
  font-size: var(--font-size-12);
  color: var(--color-text-meta);
  margin-bottom: 4px;
}

.composer-status-value {
  font-size: var(--font-size-13);
  font-family: var(--font-mono, monospace);
  color: var(--color-text);
  word-break: break-all;
}

.composer-status-bar-track {
  height: 6px;
  border-radius: 3px;
  background: var(--color-popover-divider);
  overflow: hidden;
  margin: 4px 0;
}

.composer-status-bar-fill {
  height: 100%;
  width: calc(var(--usage-ratio, 0) * 100%);
  border-radius: 3px;
  background: var(--color-accent);
  transition: width 0.2s ease;
}

.composer-status-bar-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-12);
}

.composer-status-bar-percent {
  color: var(--color-text);
  font-weight: 500;
}

.composer-status-bar-detail {
  color: var(--color-text-meta);
}

.composer-status-empty {
  padding: 8px 0;
  color: var(--color-text-meta);
  font-size: var(--font-size-12);
}

.composer-status-empty-error {
  color: var(--color-danger);
}
```

- [ ] **Step 7: 运行测试验证**

Run: `bun test apps/desktop/src/renderer/features/session/ComposerStatusOverlay.test.tsx`
Expected: PASS

- [ ] **Step 8: 运行 CSS 检查**

Run: `bun run desktop:css:check`
Expected: PASS（如果新增 CSS 在 allowlist 中报错，按提示更新 `scripts/check-desktop-css-overrides.mjs` 的 allowlist）

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/features/session/ComposerStatusOverlay.tsx apps/desktop/src/renderer/features/session/ComposerStatusOverlay.test.tsx apps/desktop/src/renderer/styles/features/composer.scss
git commit -m "feat(desktop): create ComposerStatusOverlay component with session, context and quota display"
```

---

### Task 4: 将状态弹层集成到 ComposerCard

**Files:**
- Modify: `apps/desktop/src/renderer/features/session/ComposerCard.tsx`

- [ ] **Step 1: 将 `"status"` 加入 `ComposerDropdown` 类型**

在 `ComposerCard.tsx` 中：

```typescript
type ComposerDropdown =
  | "context"
  | "permission"
  | "model"
  | "project"
  | "mode"
  | "branch"
  | "status";  // ← 新增
```

- [ ] **Step 2: 激活「状态」条目**

在 `unifiedMenuItems` 的 status 条目中（约第 519-528 行）：
- 移除 `disabled: true`
- 将 `onSelect` 改为 `() => setOpenDropdown("status")`

```typescript
{
  group: "添加",
  key: "status",
  commandName: "status",
  label: "状态",
  hint: "显示任务 ID、上下文用量和速率限制",
  icon: <Activity size={14} />,
  matchText: "状态 status task id context usage rate limit",
  // disabled: true,  ← 移除
  onSelect: () => setOpenDropdown("status"),  // ← 更新
},
```

- [ ] **Step 3: 导入 `ComposerStatusOverlay`**

在 `ComposerCard.tsx` 顶部与其他导入一起添加：

```typescript
import { ComposerStatusOverlay } from './ComposerStatusOverlay.js'
```

- [ ] **Step 4: 在 ComposerCard 的 Props 中加入 `routedSessionId`**

在 Props 类型中（约第 203 行）添加：

```typescript
  routedSessionId?: string | null;
```

在函数参数解构中（约第 266 行）添加同名参数。然后在 `DesktopComposer.tsx` 渲染 `ComposerCard` 的位置（约第 314 行）将 `routedSessionId` 传给 `ComposerCard`（该值已从 `DesktopComposer` 的 props 中获得）。

- [ ] **Step 5: 渲染状态弹层**

在 `ComposerCard` 的 JSX 中、现有 `ChatInputDropdown` 区块之后（例如在 `+` 上下文菜单的 `ChatInputDropdown` 之后），添加：

```typescript
<ComposerStatusOverlay
  open={openDropdown === "status"}
  onClose={closeDropdown}
  routedSessionId={routedSessionId}
  contextUsage={contextUsage}
  selectedProviderID={selectedProviderID}
  side={contextDropdownSide}
/>
```<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="Read">
<｜｜DSML｜｜parameter name="file_path" string="true">D:\VueProject\ClaudeCode\apps\desktop\src\renderer\features\session\ComposerCard.tsx