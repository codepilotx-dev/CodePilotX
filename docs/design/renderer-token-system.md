# Renderer Design Token 规范

本文定义 Renderer 的统一 Token 选择规则。颜色语义继续以
[`renderer-color-system.md`](./renderer-color-system.md) 为唯一规范；本文只补充排版、间距、圆角、动效、阴影和层级。

## 目标与边界

Token 的职责是让人和 Agent 根据语义做出同一个选择，而不是保存每一个历史像素值。
Renderer 只使用三层变量：

1. `--cpx-sys-*`：跨 Feature 公共语义，任何 Renderer 消费方可使用。
2. `--cpx-comp-*`：基础组件内部槽位，仅对应组件样式可使用；Feature 不得消费其几何 Token。
3. Feature 局部变量：在拥有该布局的选择器内声明，仅用于运行时尺寸、响应式公式、Diff 坐标等无法静态归入系统刻度的值。

禁止新增无命名空间的全局 `--control-*`、`--layout-*`、`--app-icon-*`、`--menu-*`，也禁止按页面或实例命名新的系统 Token。

## 固定选择流程

新增或修改样式时必须依次回答：

1. **内容角色**：这是 caption、label、正文、标题还是 code？
2. **组件/布局角色**：这是组件内部槽位、普通 Feature 间距，还是跨 Feature 的布局约束？
3. **密度**：在 4px 刻度中选择最接近的紧凑、默认或宽松节奏。
4. **状态与动效**：变化属于即时反馈、退出、状态切换、进入、面板还是持续加载？
5. **层级**：元素属于局部、sticky、dock、composer、modal、popover、tooltip 还是 toast？

只有完成前一项后才选择下一项；颜色 tone、交互状态和层级不能用几何大小互相替代。

## 公共语义

### 排版

排版角色为 `caption / label / body-sm / body / body-lg / heading-sm / heading-md / heading-lg / code`，通过 `--cpx-sys-type-*` 使用。需要单独设置属性时，复用角色所依赖的 `--cpx-sys-font-size-*`、`--cpx-sys-line-height-*` 和 `--cpx-sys-font-weight-*`，不得写裸字号或行高。

界面字号与代码字号设置仍是主题输入：运行时只更新 `--cpx-sys-font-size-ui`、`--cpx-sys-font-size-code` 及其派生刻度；语义角色自动随之变化。

### 间距

普通 padding、margin 和 gap 只使用开放 4px 刻度：

| Token | 值 |
| --- | --- |
| `--cpx-sys-space-1..8` | `4 / 8 / 12 / 16 / 20 / 24 / 28 / 32px` |

页面边距、阅读宽度、Composer 安全区和侧栏缩进等跨 Feature 约束使用 `--cpx-sys-layout-*`。响应式 `vh/vw`、运行时面板宽度或拖拽边界必须声明为拥有选择器的局部变量；不得把实例尺寸提升为系统 Token。

### 圆角

按形态选择 `indicator / compact / control / container / floating / prominent / pill`。既有六级语义继续固定为 `2 / 4 / 8 / 12 / 16 / 9999px`；`prominent` 的基础值为 `20px`，只表示持续覆盖工作区的主要 Composer 和 inline 线程环境摘要。Feature 不得引用 Button、Input、Row、Dropdown 等组件私有 radius。

`--cpx-sys-radius-optical-scale` 是选择性光学校正，不是主题设置。支持 `corner-shape` 时，明确接入的控件使用 `--cpx-sys-corner-shape: superellipse(1.5)` 和 `1.25` 倍半径；不支持时保持普通圆角与基础数值。现有 `control / container / floating` 不得因此全局放大，`pill` 只用于真正的胶囊和圆形控件，也不参与 superellipse。Feature 禁止创建 message、Composer、Summary 等同值 system Token；嵌套表面优先继承外层半径，或根据实际 inset 从外层曲率推导。

Composer 必须将首页工具条结构、实际输入布局和圆角角色分别表达为 `data-composer-utility-bar-variant`、`data-composer-layout` 与 `data-composer-radius-variant`。`home` 只改变首页环境条与输入面的拼接关系，不决定圆角；`default + multiline` 使用 `prominent`，只有真实 `default + single-line` 使用 `pill`。`single-line` radius variant 用于覆盖默认胶囊并继续复用 `prominent`，`compact` 使用经过光学校正的 `container`。禁止根据路由、placement、空输入、附件或历史截图推测 Composer 曲率。

### 动效

时长按 `instant / feedback / exit / state / enter / panel / loading` 选择，并搭配 `--cpx-sys-ease-standard / in / out / linear`。禁止裸 `ms/s`、`cubic-bezier()` 和 easing 关键字。`data-reduce-motion="on"` 下所有系统时长必须归零。

### 阴影与层级

常驻卡片、面板和列表项使用 `--cpx-sys-shadow-resting` 或 `raised`（当前均为零阴影）。持续覆盖工作区的主要交互面仅使用 `--cpx-sys-shadow-prominent`，当前限于悬浮 Composer 和绝对定位的线程环境摘要；Modal、Popover、Dropdown、Toast 等瞬时浮层继续使用 `--cpx-sys-shadow-floating`。同一视觉树只能有一个 elevation owner，Popover 内嵌的摘要内容不得重复投影。焦点使用 `--cpx-sys-focus-ring*`。动态色板、图表或第三方表面确需精确描边时登记精确例外。

全局层级固定为 `local < sticky < dock < composer < modal < popover < tooltip < toast`。`-1..5` 只允许在明确 stacking context 内表达局部兄弟顺序；其他值必须使用系统层级 Token。

## 自动契约与例外

`scripts/check-style-contracts.ts` 的 `featureTokenContract` 扫描 Feature/lazy SCSS、TS/TSX inline style 和 Tailwind arbitrary value，并验证例外重复与 stale 状态。

例外必须同时包含文件、属性、精确值和具体原因。可接受场景包括 Diff 行号的 `ch` 对齐、运行时拖拽边界、图表坐标、动态色板对比描边和第三方内部尺寸。不能因为迁移困难、希望保留任意历史像素或检查失败而新增例外。

## 示例

```scss
.feature-toolbar {
  gap: var(--cpx-sys-space-2);
  padding: var(--cpx-sys-space-2) var(--cpx-sys-space-3);
  border-radius: var(--cpx-sys-radius-control);
  transition: opacity var(--cpx-sys-motion-state) var(--cpx-sys-ease-standard);
  z-index: var(--cpx-sys-z-sticky);
}

.responsive-empty-state {
  --empty-state-padding: clamp(var(--cpx-sys-space-3), 4vh, var(--cpx-sys-space-6));

  padding: var(--empty-state-padding);
}
```
