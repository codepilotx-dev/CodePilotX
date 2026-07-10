# Composer 状态弹层与命令去重设计

## 背景

Composer 当前的状态、上下文用量和提供商配额信息散布在工具栏 chip（上下文 chip）、侧边栏底部面板（配额）和「+」菜单中一条 disabled 的「状态」条目之间。同时，`+` 菜单中的动态 slash command 与本地硬编码入口存在视觉重复（例如「状态」条目和动态的 `/status` 命令同时出现），影响浏览效率。

## 目标

1. 将 unified menu 中现有的「状态」条目激活，改为弹出全宽状态弹层，汇总会话、上下文和提供商配额信息。
2. 为 unified menu 增加 `commandName` 去重机制，按命令名词义去重而非显示标题，消除 dropdown 中的重复项。

## 非目标

- 不新增全局状态页。
- 不改变 TUI `/status` 命令行为。
- 不汇总多个已配置提供商的配额（仅查询当前所选提供商）。
- 不改动 `DESKTOP_PRIMARY_SLASH_COMMANDS` 或主进程 `listSlashCommands`。

---

## 设计

### 1. 命令去重

#### UnifiedMenuItem 扩展

向 `UnifiedMenuItem` 类型添加可选字段：

```
commandName?: string
```

`commandName` 表示此条目对应的 slash command 名称（如 `"status"`、`"model"`、`"effort"`）。仅本地硬编码入口声明此字段；动态 slash command 条目不设置。

#### 本地入口声明

| 菜单条目 key | 显示标题 | commandName |
|---|---|---|
| `reasoning` | 推理 | `"effort"` |
| `model` | 模型 | `"model"` |
| `status` | 状态 | `"status"` |
| `goal-mode` | 目标 | `"goal"` |
| `plan-mode` | 计划模式 | `"plan"` |
| `memory` | 记忆 | `"remember"` |

「新工作树」（key `worktree`）不属于 slash command，不声明 `commandName`。

#### 保留命令名集

除本地条目声明的 `commandName` 外，额外保留 `"branch"` 命令名。该命令名无对应本地可见条目，用于挡掉动态 slash command 中由主进程 title override 设为「派生」的 `branch` 命令。

#### 动态命令过滤逻辑（修改 `unifiedMenuItems` 构建）

1. 先收集本地条目中所有非空的 `commandName`，合并保留集，得到 `ownedCommandNames`。
2. 遍历 `slashCommands` 时，若 `cmd.name` 在 `ownedCommandNames` 中则跳过。
3. 此逻辑替换现有的 `planGoalNames` 硬编码排除（`new Set(["plan", "goal"])`），因为去重已覆盖这两个名称。

---

### 2. 状态弹层

#### 组件结构

**新建** `ComposerStatusOverlay.tsx`：
- 复用 `ChatInputDropdown` 作为容器（与 `+` 菜单的 context dropdown 相同）。
- 弹层定位在 composer 上方（`side="top"`），全宽（`width="100%"`）。
- 内部区域可滚动。
- 数据异步加载完成后实时更新，不阻塞弹层打开。

```
ChatInputDropdown (side="top", width="100%")
  └── <div className="chat-input__dropdown-content">
        ├── Header: "状态" + X 关闭按钮
        ├── Session ID
        ├── 上下文用量 (进度条 + usedTokens / contextWindow)
        ├── 5 小时限额 (进度条 + 剩余数量 + 结束时间)
        ├── 7 天限额 (进度条 + 剩余数量 + 结束时间)
        └── 加载/错误/不可用状态
      </div>
```

#### 状态管理

在 ComposerCard 内部：
- `ComposerDropdown` 类型新增 `"status"`。
- 打开：`setOpenDropdown("status")` → 触发 `ChatInputDropdown` 渲染。
- 关闭：点击 X / 外部点击 / Escape → `closeDropdown()`。

#### 数据流

打开弹层时：

1. **同步数据**（已有 props）：`routedSessionId`、`contextUsage` — 立即显示。
2. **异步数据**（新获取）：调用 `desktopClient.fetchProviderBalance({ providerID: selectedProviderID })`。
   - **加载中**：显示骨架或「正在查询用量…」。
   - **成功且返回 token-plan 数据**：显示 5 小时和 7 天进度条。
   - **成功但不支持 token-plan**：显示「当前提供商未返回用量数据」。
   - **查询失败**：显示具体错误信息。
3. 仅在弹层打开时获取一次，关闭后不缓存（下次打开重新获取）。

#### 进度条 UI 模式

遵循设置页和侧边栏页脚现有模式。每个配额行包含：

- 标签（如「5 小时限额」）
- 进度条（`<meter>` / div + width 百分比）
- 剩余百分比数字
- 补充详情（剩余数量 + 结束时间）

#### 可复用工具模块

**新建** `apps/desktop/src/renderer/utils/providerBalanceUtils.ts`：

从 `SidebarFooter.tsx` 提取到公共模块的函数：
- `formatRemainingWindow(remainingTime, endTime): string`
- `formatDuration(milliseconds): string`
- `clampPercent(value): number`

提取后 `SidebarFooter.tsx` 改为从此模块导入，保持行为一致。

不提取 `buildMiniMaxRows` / `buildUsageRows`，因为状态弹层的布局不同于侧边栏的 `PopoverUsageRow` 模式；状态弹层将直接消费 `DesktopProviderTokenPlanUsageInfo` 原始数据。

#### 错误与边界状态

| 场景 | 表现 |
|---|---|
| `contextUsage === null` | 显示「暂无上下文统计」 |
| `selectedProviderID` 非计费提供商 | 限额区显示「当前提供商不支持用量查询」 |
| `fetchProviderBalance` 返回 `error` | 限额区显示具体错误 |
| 快速对话尚未创建会话 | 会话 ID 显示「尚未创建会话」 |

---

## 文件清单

### 新增文件
- `apps/desktop/src/renderer/utils/providerBalanceUtils.ts`
- `apps/desktop/src/renderer/features/session/ComposerStatusOverlay.tsx`

### 修改文件
- `apps/desktop/src/renderer/features/session/ComposerCard.tsx` — 去重逻辑 + status 可交互 + 弹层集成
- `apps/desktop/src/renderer/features/layout/sidebar/SidebarFooter.tsx` — 改用公共工具模块

---

## 测试计划

### 命令去重
- 本地入口声明 `commandName` 后，同名的动态 slash command 不显示。
- `branch` 命令名的动态条目被保留集排除。
- 显示标题不同但 `commandName` 相同的情况仍去重。
- 自定义命令和技能不受影响。

### 状态弹层
- 打开弹层后显示正确的会话 ID（或「尚未创建会话」）。
- 上下文进度条显示正确的百分比、已用 token 和总窗口。
- 5 小时 / 7 天配额行显示正确的进度、剩余量和结束时间。
- 加载中显示加载状态，错误时显示错误信息，不支持时显示不可用提示。
- 点击外部 / Escape / X 关闭弹层。

---

## 实施顺序

1. 提取公共工具模块 `providerBalanceUtils.ts`，更新 `SidebarFooter.tsx` 的导入。
2. 在 `ComposerCard.tsx` 中添加 `commandName` 字段和去重逻辑。
3. 实现 `ComposerStatusOverlay.tsx` 组件。
4. 在 `ComposerCard.tsx` 中集成弹层（`openDropdown` 类型 + 渲染）。
5. 运行 `bun run desktop:typecheck` 和 `bun run desktop:css:check` 验证。
