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

## Oreo 设计语言适配

Oreo Agentic UI Library 作为 CodePilotX 的视觉参考，不形成平行 Token 或组件体系。其 Foundation 直接映射到现有 `--cpx-sys-*`：Color 使用 surface、foreground、border、tone 与 interaction 语义，Typography 使用现有角色刻度，Shadow 仅用于瞬时浮层和持续覆盖工作区的交互面，Radius、Space 与 Motion 继续使用本规范的公共刻度。

CodePilotX 保留现有信息架构、Coding / Working / Chat 模式、鲸鱼品牌和桌面交互契约。首页、空状态与引导页使用宽松节奏；Workbench、侧栏、终端、Review 和设置使用紧凑节奏。Oreo 中的 Button、Shortcuts、Chip、Tag、Avatar、Loading、Prompt、Sidebar、Navbar 与 Pop-up 优先复用现有基础组件；只有真实调用方无法表达时才扩展公共组件。

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

排版角色为 `caption / label / body-sm / body / body-lg / heading-sm / heading-md / heading-lg / heading-xl / code`，通过 `--cpx-sys-type-*` 使用。`heading-xl` 仅用于一级页面的主标题。需要单独设置属性时，复用角色所依赖的 `--cpx-sys-font-size-*`、`--cpx-sys-line-height-*` 和 `--cpx-sys-font-weight-*`，不得写裸字号或行高。

| 角色 | 默认字号 / 行高 / 字重 | 内容职责 | 默认前景色 |
| --- | --- | --- | --- |
| `caption` | `12 / 16 / 445` | 时间、路径、计数、快捷键和辅助状态 | `fg-tertiary` |
| `label` | `12 / 16 / 500` | 分组名、字段标签和短状态标签 | 按上下文选择 secondary 或 tertiary |
| `body-sm` | `13 / 18 / 445` | 说明、次要正文和紧凑导航 | `fg-secondary` |
| `body` | `14 / 20 / 445` | 全局正文、列表、菜单和聊天 | `fg-primary` |
| `body-lg` | `16 / 24 / 445` | 首页 Composer 和局部引导正文 | `fg-primary` |
| `heading-sm` | `16 / 22 / 500` | 设置章节和卡片主要标题 | `fg-primary` |
| `heading-md` | `18 / 24 / 500` | 中级页面标题和 Markdown H2 | `fg-primary` |
| `heading-lg` | `20 / 28 / 500` | 强页面分区标题 | `fg-primary` |
| `heading-xl` | `24 / 30 / 500` | 一级页面、首页 Hero 和 Markdown H1 | `fg-primary` |
| `code` | `用户代码字号 / 1.55 / 400` | 代码、命令、Diff 和终端 | 按语法或上下文选择 |

普通 sans-serif 内容使用 `--cpx-sys-font-weight-body: 445`，标题和关键标签使用 `500`，正文内真正的强调使用 `600`；`400` 只保留给代码等真实常规字重。选中态通过背景和前景色表达，不得为了选中而改变普通列表项字重。

界面字号与代码字号设置仍是两个独立主题输入。UI 默认字号是 `14px`，运行时先计算 `delta = uiFontSize - 14`，再将同一差值应用到 `12 / 13 / 14 / 16 / 18 / 20 / 24 / 28px` 完整刻度，因此所有语义角色在 UI 字号 `11–16px` 范围内保持相对层级。代码字号在 `8–24px` 范围独立更新 `--cpx-sys-font-size-code`，不参与 UI delta；新设置默认使用 `13px`，已有用户设置原样保留。

颜色与排版角色互相独立：正文和关键值使用 `--cpx-sys-color-fg-primary`，说明使用 `fg-secondary`，时间、路径和其他辅助元信息使用 `fg-tertiary`，`fg-disabled` 只用于真实禁用态。业务成功、警告和错误继续使用对应 tone，不以异常字号或额外粗体代替状态语义。

### 间距

普通 padding、margin 和 gap 只使用开放 4px 刻度：

| Token | 值 |
| --- | --- |
| `--cpx-sys-space-1..8` | `4 / 8 / 12 / 16 / 20 / 24 / 28 / 32px` |

页面边距、阅读宽度、Composer 安全区和侧栏缩进等跨 Feature 约束使用 `--cpx-sys-layout-*`。响应式 `vh/vw`、运行时面板宽度或拖拽边界必须声明为拥有选择器的局部变量；不得把实例尺寸提升为系统 Token。

### 圆角

圆角采用“基础刻度 + 语义角色”双层结构。基础刻度是唯一数值来源：

| 基础 Token | 回退值 | 支持 superellipse 时 |
| --- | ---: | ---: |
| `--cpx-sys-radius-2xs` | 2px | 2.5px |
| `--cpx-sys-radius-xs` | 4px | 5px |
| `--cpx-sys-radius-sm` | 6px | 7.5px |
| `--cpx-sys-radius-md` | 8px | 10px |
| `--cpx-sys-radius-lg` | 10px | 12.5px |
| `--cpx-sys-radius-xl` | 12px | 15px |
| `--cpx-sys-radius-2xl` | 16px | 20px |
| `--cpx-sys-radius-3xl` | 20px | 25px |
| `--cpx-sys-radius-4xl` | 24px | 30px |
| `--cpx-sys-radius-full` | 9999px | 9999px |

跨 Feature 语义固定映射为 `indicator → 2xs`、`compact → xs`、`control → md`、`container → lg`、`floating → xl`、`prominent → 3xl`、`pill → full`。普通输入与图标按钮使用 `md`，列表行与普通卡片使用 `lg`，菜单和 Popover 使用 `xl`，用户消息使用 `2xl`，多行 Composer、inline 线程环境摘要与 Dialog 使用 `3xl`。`4xl` 是完整刻度中的预留层级，没有匹配职责时不得为了消费 Token 强行使用。Feature 不得引用 Button、Input、Row、Dropdown 等组件私有 radius，也不得创建 message、Composer、Summary 等同值 system Token。

`--cpx-sys-radius-optical-scale` 是统一光学校正，不是主题设置；它只能在 `2xs` 至 `4xl` 基础 Token 中计算一次，消费方不得再次乘 scale。支持 `corner-shape` 时，`md` 至 `4xl` 使用公共 `--cpx-sys-corner-shape: superellipse(1.5)`，不支持时使用表中的回退值；`2xs / xs / sm / full` 保持普通 round。`full` 只用于真正的胶囊、圆形控件、Badge、Chip、Toggle track 等，不得用于普通卡片、列表行、Dialog 或矩形表面。嵌套表面优先继承外层半径，或根据实际 inset 选择下一档较小刻度。

Composer 必须将首页工具条结构、实际输入布局和圆角角色分别表达为 `data-composer-utility-bar-variant`、`data-composer-layout` 与 `data-composer-radius-variant`。`home` 只改变首页环境条与输入面的拼接关系，不决定圆角；`default + multiline` 使用 `prominent / 3xl`，只有真实 `default + single-line` 使用 `pill / full`。`single-line` radius variant 用于覆盖默认胶囊并继续复用 `prominent / 3xl`，`compact` 使用 `container / lg`。禁止根据路由、placement、空输入、附件或历史截图推测 Composer 曲率。

### 动效

时长按 `instant / feedback / exit / state / enter / panel / loading` 选择，并搭配 `--cpx-sys-ease-standard / in / out / linear`。统一时长依次为 `0 / 60 / 90 / 100 / 120 / 120 / 900ms`：hover 与按压使用 `feedback`，退出使用 `exit`，非布局状态使用 `state`，浮层进入使用 `enter`，高度与位置编排使用 `panel`，持续循环使用 `loading`。直接指针操作期间的位置反馈必须使用 `instant` 当帧跟随，释放后、键盘操作或外部状态同步才可使用 `state` 落位。禁止裸 `ms/s`、`cubic-bezier()` 和 easing 关键字。`data-reduce-motion="on"` 下所有系统时长必须归零。

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

.feature-title {
  color: var(--cpx-sys-color-fg-primary);
  font: var(--cpx-sys-type-heading-sm);
}

.feature-description {
  color: var(--cpx-sys-color-fg-secondary);
  font: var(--cpx-sys-type-body-sm);
}

.feature-meta {
  color: var(--cpx-sys-color-fg-tertiary);
  font: var(--cpx-sys-type-caption);
}

.responsive-empty-state {
  --empty-state-padding: clamp(var(--cpx-sys-space-3), 4vh, var(--cpx-sys-space-6));

  padding: var(--empty-state-padding);
}
```
