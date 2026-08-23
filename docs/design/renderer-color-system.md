# Renderer 颜色语义规范

## 目标与分层

颜色用于表达空间层级、交互状态和业务含义，而不是装饰页面。Renderer 只有三层颜色来源：

1. **主题输入**：用户设置的强调色、背景、前景和对比度，只由主题派生器读取。
2. **系统语义颜色**：`--cpx-sys-color-*`，是 feature、页面和业务组件选择颜色的唯一入口。
3. **组件私有实现**：`--cpx-comp-*`，只允许在 `src/styles/components/`、基础浮层和对应基础组件内部组合尺寸、边框、阴影与系统语义色；feature 不得引用其中的颜色值。

新增颜色不是禁区，但必须先证明现有语义无法表达，再在系统层定义稳定含义。禁止用页面名、功能名、组件实例名或视觉描述（例如 `lighter-green-card`）创建公共颜色。

## 公共语义角色

### 空间与文字

| 角色 | 使用场景 | 禁止场景 |
| --- | --- | --- |
| `surface-canvas` | 页面、主工作区 | 卡片、输入框 |
| `surface-recessed` | 侧栏、代码底板、下沉区域 | 浮层 |
| `surface-panel` | 常驻面板、卡片、摘要、审批容器 | 模态和下拉 |
| `surface-control` | 输入框、选择器、Composer 输入面 | 页面底色 |
| `surface-raised` | Modal、Popover、Dropdown、Toast、悬浮 Composer | 常驻卡片 |
| `surface-editor` | Diff、编辑器、预格式化代码 | 普通正文 |
| `fg-primary` | 标题、正文、关键值 | 元信息 |
| `fg-secondary` | 说明、次要操作 | 禁用信息 |
| `fg-tertiary` | 时间、来源、低优先级元信息 | 正文 |
| `fg-disabled` | 不可交互内容 | 可操作内容 |
| `border-subtle/default/strong/focus` | 同级分隔、容器、强调边界、键盘焦点 | 用边框颜色假装业务状态 |

常驻容器通过相邻表面与 1px 边框形成层级，不加阴影。只有真实浮层使用 `--cpx-sys-shadow-floating`。

### Workbench 区域

Workbench 大区域使用独立的公共区域 token，布局 Feature 不直接绑定基础 surface：

| 区域 | 语义 token | 默认来源 |
| --- | --- | --- |
| 窗口标题/菜单栏 | `--cpx-sys-color-workbench-titlebar-bg` | `--cpx-sys-color-surface-recessed` |
| 左侧栏 | `--cpx-sys-color-workbench-sidebar-bg` | `--cpx-sys-color-surface-recessed` |
| 主工作区 | `--cpx-sys-color-workbench-main-bg` | `--cpx-sys-color-surface-canvas` |
| 右侧 Dock、底部 Panel | `--cpx-sys-color-workbench-panel-bg` | `--cpx-sys-color-workbench-main-bg` |

`surface-panel` 仍用于工作区内部的常驻卡片、摘要和审批容器，不代表右侧 Dock 或底部 Panel 的外层底色。Feature 只消费公开区域 token，不消费颜色类 `--cpx-comp-*`，也不直接选择基础 surface。默认值相同的区域仍保持独立 token，以允许主题覆盖并避免组件耦合；工作区 toolbar/header 保持透明并继承 `workbench-main-bg`，不使用 titlebar token。

### 业务与交互语义

| Tone | 唯一含义 | 典型场景 |
| --- | --- | --- |
| `accent` | 当前选择、焦点、主要交互 | 选中导航、焦点环、当前配置 |
| `info` | 中性信息、来源、无风险进行中 | 提示、来源、同步中 |
| `success` | 已成功、已通过、已连接 | 完成状态、批准、Diff added |
| `warning` | 需注意、等待判断、可恢复风险 | 待审批、限额提醒 |
| `danger` | 失败、拒绝、破坏性操作 | 删除、权限拒绝、Diff removed |
| `skill` | Agent、Skill、Plugin、工具能力身份 | 能力标签、工具身份 |

每个彩色 tone 使用一致的角色族：基础色用于小图标或状态点，`*-fg` 用于短文字，`*-subtle-bg` 与 `*-subtle-border` 成对用于状态容器。大面积实色背景、仅靠红绿区分状态、用 `success` 表示“当前选中”都不允许。

Hover、selected、active 是交互阶段，不是业务状态；使用统一的 `hover`、`selected`、`active`，不得在 feature 中临时混合强调色。

## Agent 选择流程

1. 先判断内容是否有明确业务含义；有则从六个 tone 中选择，没有则保持 neutral。
2. 根据空间位置选择一种 surface；不要为同级卡片轮换颜色。
3. 根据阅读优先级选择一种 foreground，并按容器关系选择 border。
4. 只有真实交互才叠加 hover、selected、active 或 focus。
5. 找不到角色时停止编码，补充语义定义、明暗主题算法、适用和禁用场景后再新增 system token。

同一容器最多使用一个业务 tone，且必须同时提供文字、图标或标签线索。状态卡片的标准组合是：

```scss
.connection-state[data-tone='warning'] {
  color: var(--cpx-sys-color-warning-fg);
  border: 1px solid var(--cpx-sys-color-warning-subtle-border);
  background: var(--cpx-sys-color-warning-subtle-bg);
}
```

错误示例：

```scss
/* feature 越权消费组件内部颜色 */
background: var(--cpx-comp-input-bg);

/* 无主题语义、不能适配明暗模式 */
color: #3d8f72;

/* 在调用点发明另一套状态强度 */
background: color-mix(in srgb, var(--cpx-sys-color-warning) 9%, var(--cpx-sys-color-surface-panel));
```

## 例外与自动检查

`css:check` 对 `src/styles/features/` 和 `src/styles/lazy/` 强制执行：

- 禁止引用颜色类 `--cpx-comp-*`；尺寸、圆角等非颜色组件契约不受此规则影响。
- 禁止十六进制、RGB、HSL 等裸颜色。
- 禁止在 feature 中混合两个系统语义颜色，或用局部颜色变量自行派生新色阶。
- 色盘、图表数据色和第三方终端等确实无法由单个语义角色表达的算法，必须在 `style-contracts.json` 记录精确的文件与 token、字面值或局部变量，并写明原因。
- 每个例外必须被真实代码使用；代码迁移后未删除的 stale 例外会导致检查失败。禁止文件级通配、数量基线和“为了通过检查”批量刷新例外。

新增 system tone 的评审必须同时回答：它表达什么、与现有 tone 的差异、哪些场景禁止使用、浅色与暗色如何派生、文字对比度是否至少达到 WCAG AA，以及旧 Agent 是否可以安全忽略它。
