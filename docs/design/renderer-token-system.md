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

### UI-Design 视觉体系落地

CodePilotX 全面采用 UI-Design 视觉体系（基于 `F:\CodeProject\UI-Design`）：

1. **基础 Token 统一**：
   - 统一使用 `--cpx-sys-*` 与 `--cpx-comp-*` 契约，杜绝平行 Token 体系。
   - 恢复 Apple HIG 风格的优雅基础圆角（4px ~ 28px、pill 9999px）与无光学校正（optical scale 1.0）。
   - 恢复多阶轻盈半透明投影（Resting、Raised、Floating、Control、Prominent）及毛玻璃模糊（8px / 16px / 24px）。
2. **基础组件与业务组件全面对齐**：
   - 基础控件（`Button`、`Input`、`Switch`、`Card`、`SegmentedControl`、`Modal`、`Popover` 等）统一接入系统圆角、投影与微动效。
   - 业务组件（Composer、ModelSelect、Session 消息卡片、Sidebar、Settings 等）移除私有几何与投影变量，直接收敛至语义 Token。
3. **外观设置保留与默认配色选择**：
   - V6 保留式升级至 V7；有效 V6/V7 设置不因迁移记录缺失而重置。旧 pending 记录仅完成记账并保留当前设置及原备份，completed、未知或不可读记录继续保留。
   - 设置页通过浅色、深色主题下拉中的 `Codex` 与 `Codex(new)` 选择原版或新版默认配色，不再显示独立的应用与恢复按钮；选择新配色保留自定义字体与字号。V1～V5 和损坏 JSON 仍遵守既有恢复契约。

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

排版先按内容职责分为展示、结构、交互、阅读和代码五条层级，再通过 `--cpx-sys-type-*` 使用。系统字体优先使用 Windows 自带的 `Segoe UI Variable Text`，并回退到 `Segoe UI` 和平台系统字体；只使用稳定的 `400 / 500 / 600` 字重，不打包额外 UI 字体。需要单独设置属性时，复用角色所依赖的 `--cpx-sys-font-size-*`、`--cpx-sys-line-height-*` 和 `--cpx-sys-font-weight-*`，不得写裸字号或行高。

| 角色         | 默认字号 / 行高 / 字重                            | 内容职责                                 | 默认前景色                         |
| ------------ | ------------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| `display`    | `28 / 34 / 600`                                   | Coding、Working 与 Chat 首页 Hero        | `fg-primary`                       |
| `caption`    | `12 / 16 / 400`                                   | 时间、路径、计数和辅助状态               | `fg-tertiary`                      |
| `label`      | `12 / 16 / 500`                                   | 分组名、字段标签和短状态标签             | 按上下文选择 secondary 或 tertiary |
| `body-sm`    | `13 / 18 / 400`                                   | 次级说明、工具活动和侧栏辅助文字         | `fg-secondary`                     |
| `control`    | `13 / 18 / 500`                                   | Button、Input、Menu、紧凑导航和文件行    | `fg-primary`                       |
| `body`       | `14 / 20 / 400`                                   | 普通 UI 正文、评论和表单说明             | `fg-primary`                       |
| `row-title`  | `14 / 20 / 500`                                   | 设置行、卡片行和普通对象名称             | `fg-primary`                       |
| `reading`    | `14 / 24 / 400`                                   | 用户消息、Agent 最终回答和 Markdown 长文 | `fg-primary`                       |
| `body-lg`    | `16 / 24 / 400`                                   | 首页 Prompt 和短引导正文                 | `fg-primary`                       |
| `heading-sm` | `16 / 22 / 600`                                   | Section、Dialog、Popover 和 Markdown H3  | `fg-primary`                       |
| `heading-md` | `18 / 24 / 600`                                   | 重点卡片和详情页局部主标题               | `fg-primary`                       |
| `heading-lg` | `20 / 28 / 600`                                   | Markdown H2 和强信息分区                 | `fg-primary`                       |
| `heading-xl` | `24 / 30 / 600`                                   | 一级页面、Setup 主标题和 Markdown H1     | `fg-primary`                       |
| `metric`     | `20 / 28 / 600`                                   | 金额、用量和统计值；使用 tabular figures | `fg-primary`                       |
| `code`       | `13 / 20 / 400`（随用户代码字号保持 `+7px` 行高） | 代码、命令、Diff 和终端                  | 按语法或上下文选择                 |

普通正文使用 `400`，控件、标签和行标题使用 `500`，结构标题、指标和真正的强调使用 `600`。选中态通过背景和前景色表达，不得为了选中而改变普通列表项字重。UI 文本不得借用 `reading` 获取额外行距，工具活动也不得借用 `body` 与最终回答争夺层级。

界面字号与代码字号设置仍是两个独立主题输入。UI 默认字号是 `14px`，运行时先计算 `delta = uiFontSize - 14`，再将同一差值应用到 `12 / 13 / 14 / 16 / 18 / 20 / 24 / 28px` 完整刻度，因此所有语义角色在 UI 字号 `11–16px` 范围内保持相对层级。代码字号在 `8–24px` 范围独立更新 `--cpx-sys-font-size-code`，不参与 UI delta；新设置默认使用 `13px`，已有用户设置原样保留。

颜色与排版角色互相独立：正文和关键值使用 `--cpx-sys-color-fg-primary`，说明使用 `fg-secondary`，时间、路径和其他辅助元信息使用 `fg-tertiary`，`fg-disabled` 只用于真实禁用态。业务成功、警告和错误继续使用对应 tone，不以异常字号或额外粗体代替状态语义。

### 图标

功能图标固定使用 `12 / 16 / 20 CSS px`，按位置职责选择，默认 `16px`。尺寸不跟随 UI 字号设置；应用整体缩放仍正常生效。

| 档位        | 系统 Token / React 常量                        | 使用场景                                                                                                           |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 辅助 · 12px | `--cpx-sys-icon-size-sm` / `APP_ICON_SIZES.sm` | 展开与下拉箭头、选中勾、标签关闭、清除、行尾更多/置顶/归档、时间线状态、元信息                                     |
| 常规 · 16px | `--cpx-sys-icon-size-md` / `APP_ICON_SIZE`     | 侧栏导航与项目、侧栏行尾状态与操作、菜单前置图标、搜索、工具栏、普通按钮、文件/文件夹、附件、Composer 添加与麦克风 |
| 突出 · 20px | `--cpx-sys-icon-size-lg` / `APP_ICON_SIZES.lg` | Composer 发送/停止、大尺寸动作按钮、独立空状态与结果提示符号                                                       |

`--cpx-sys-icon-size` 是默认 `md` 的别名；组件 `sm/md/lg` 分别映射三档。`Button` 与 `IconButton` 的 `iconSize="sm|md|lg"` 只控制图标，不改变点击区域、行高或按钮颜色。未指定时，`compact / composerSm / iconSm / iconMd` 使用 12px，`large / iconLarge` 使用 20px，其余使用 16px；组合按钮的尾部箭头使用 12px，显式 `iconSize` 优先。按钮加载指示器与所在按钮的图标同尺寸；独立 `Spinner` 的 `small/medium/large` 使用 12/16/20px。文件/文件夹默认 16px，异步加载前后保持一致。

同组同级操作保持一致，菜单前置图标为 16px、尾部勾选与箭头为 12px。`primary`、危险、选中、hover、禁用或加载状态不决定尺寸；状态替换必须保持原尺寸，例如发送、停止、发送中均为 20px。20px 不用于紧凑行尾操作。图标盒子必须正方形、居中且不收缩；普通图文间距沿用 4px，列表与菜单沿用现有间距 Token。普通 Lucide 图标统一使用 `--cpx-sys-icon-stroke-width` / `APP_ICON_STROKE_WIDTH`（1.6），样式同样覆盖未指定 `strokeWidth` 时的默认值；1.6 是 24×24 viewBox 内的线宽，随显示尺寸缩放，功能图标不使用 `absoluteStrokeWidth`。彩色文件与填充图标保留原始绘制方式，不测量图形边界或添加逐图标偏移。

头像、鲸鱼、品牌形象、Provider/插件/Skill Logo、宠物、内容图片、插图、图表、安装包图标和系统原生窗口按钮不属于功能图标。它们及其占位图形由各自槽位管理，保留原有几何，不随功能图标 Token 变化。其中的 Lucide 占位图标必须标记 `data-icon-kind="artwork"`，保留原始描边属性和局部样式，并将其自身的描边 Token 保持为 2，避免组件局部样式受到功能图标轻轮廓的影响。禁止新增其他功能图标尺寸，也禁止使用全局或整个区域的 `svg` / `img` 选择器强制覆盖尺寸；样式只能作用于组件拥有的图标槽位。

侧栏导航、项目前置图标、行尾时钟/分叉状态及置顶/归档/更多/新建操作统一使用 16px。行尾按钮显式指定 `iconSize="md"`，覆盖紧凑按钮默认的 12px；运行状态 Spinner 使用 `medium`，点击区域保持原有大小。

### 间距

普通 padding、margin 和 gap 只使用开放 4px 刻度：

| Token                  | 值                                      |
| ---------------------- | --------------------------------------- |
| `--cpx-sys-space-1..8` | `4 / 8 / 12 / 16 / 20 / 24 / 28 / 32px` |

页面边距、阅读宽度、Composer 安全区和侧栏缩进等跨 Feature 约束使用 `--cpx-sys-layout-*`。响应式 `vh/vw`、运行时面板宽度或拖拽边界必须声明为拥有选择器的局部变量；不得把实例尺寸提升为系统 Token。

### 圆角

圆角采用“基础刻度 + 语义角色”双层结构。基础刻度是唯一数值来源：

| 基础 Token              |   数值 | 映射语义角色与使用场景                                    |
| ----------------------- | -----: | --------------------------------------------------------- |
| `--cpx-sys-radius-2xs`  |    4px | `indicator`：状态圆点、紧凑标签、微型指示条               |
| `--cpx-sys-radius-xs`   |    6px | `compact`：快捷键徽标、轻量提示                           |
| `--cpx-sys-radius-sm`   |    8px | `item`：菜单项、侧边栏导航项、Tooltip                     |
| `--cpx-sys-radius-md`   |   10px | `control`：普通按钮、输入框、分段选择器                   |
| `--cpx-sys-radius-lg`   |   12px | `container` / `floating`：卡片、下拉浮层、Popover 面板    |
| `--cpx-sys-radius-xl`   |   14px | 较大卡片、抽屉内胆                                        |
| `--cpx-sys-radius-2xl`  |   16px | `prominent`：对话框（Modal）、Composer 悬浮容器、消息气泡 |
| `--cpx-sys-radius-3xl`  |   20px | 大型模态窗口、导引面板                                    |
| `--cpx-sys-radius-4xl`  |   28px | 预留特大层级                                              |
| `--cpx-sys-radius-full` | 9999px | `pill`：胶囊按钮、Switch 开关、标签胶囊、药丸触发器       |

光学校正统一为 `1.0`（无超椭圆畸变，纯净 Apple HIG 风格），所有表面均遵循上述标准刻度。`full` 只用于真正的胶囊、圆形控件、Badge、Chip、Toggle track 等，不得用于普通卡片、列表行、Dialog 或矩形表面。嵌套表面优先继承外层半径，或根据 `inner radius = max(outer radius - inset, 0)` 计算并映射到最近的已有 Token。

Composer 必须将首页工具条结构、实际输入布局和圆角角色分别表达为 `data-composer-utility-bar-variant`、`data-composer-layout` 与 `data-composer-radius-variant`。`home` 只改变首页环境条与输入面的拼接关系，不决定圆角；`default + multiline` 使用 `prominent / 2xl (16px)`，只有真实 `default + single-line` 使用 `pill / full`。

### 动效

时长按 `instant / feedback / exit / state / enter / panel / loading` 选择，并搭配 `--cpx-sys-ease-standard / in / out / linear`。统一时长依次为 `0 / 60 / 80 / 60 / 80 / 100 / 900ms`：直接指针 hover 背景与拖拽跟随使用 `instant`，hover 按压及文本颜色反馈使用 `feedback`，退出使用 `exit`，非布局状态使用 `state`，浮层进入使用 `enter`，高度与位置编排使用 `panel`，折叠展开使用 `disclosure (100ms)`，持续循环使用 `loading`。直接指针操作期间的位置反馈必须使用 `instant` 当帧跟随，释放后、键盘操作或外部状态同步才可使用 `state` 落位。全局 Tooltip 遵循首次延迟 350ms (`delayDuration`) 与组内快速切换 300ms (`skipDelayDuration`) 规则。禁止裸 `ms/s`、`cubic-bezier()` 和 easing 关键字。`data-reduce-motion="on"` 下所有系统时长必须归零。

### 阴影与层级

分级轻量投影提供真实桌面层次感（Dark 模式下自动加深透明度保证深底对比度）：

- 常驻卡片与容器：`--cpx-sys-shadow-resting`（浅色 `0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)` / 深色 `0 2px 8px rgba(0,0,0,0.4)`）。
- 抬升与激活项：`--cpx-sys-shadow-raised`（浅色 `0 4px 14px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.03)` / 深色 `0 4px 14px rgba(0,0,0,0.45)`）。
- 悬浮控件与分段激活钮：`--cpx-sys-shadow-control`（浅色 `0 1px 2px rgba(0,0,0,0.04)` / 深色 `0 1px 2px rgba(0,0,0,0.3)`）。
- 浮层与弹窗：`--cpx-sys-shadow-floating`（浅色 `0 8px 30px rgba(0,0,0,0.12)` / 深色 `0 8px 30px rgba(0,0,0,0.5)`）。
- 突出主交互面（悬浮 Composer、Dialog 等）：`--cpx-sys-shadow-prominent`（浅色 `0 12px 36px rgba(0,0,0,0.14)` / 深色 `0 12px 36px rgba(0,0,0,0.6)`）。
- 毛玻璃背景模糊：`--cpx-sys-blur-sm` (8px)、`--cpx-sys-blur-md` (16px)、`--cpx-sys-blur-lg` (24px)。

全局层级固定为 `local < sticky < dock < composer < modal < popover < tooltip < toast`。`-1..5` 只允许在明确 stacking context 内表达局部兄弟顺序；其他值必须使用系统层级 Token。

全局层级固定为 `local < sticky < dock < composer < modal < popover < tooltip < toast`。`-1..5` 只允许在明确 stacking context 内表达局部兄弟顺序；其他值必须使用系统层级 Token。

## Tailwind 消费方式

组件与页面外观写在 TSX 的 `tw:` utility 里，Token 通过 `src/styles/tailwind.css` 的 `@theme` / `@theme inline` 映射消费。

- 引用运行时变量（浅色/深色/自定义主题会改变的值）写在 `@theme inline`，例如 `--color-app-panel: var(--cpx-sys-color-surface-panel)`，让 utility 直接用 `var(--cpx-sys-color-*)`，而不是复制一份静态值。
- 静态值（如 `--spacing: 0.25rem`）写在普通 `@theme`；`--*: initial` 先清空 Tailwind 默认调色板，使 `--cpx-sys-*` 成为唯一真源。
- 排版用 `@utility type-*` 消费完整字体角色（`tw:type-title-md`、`tw:type-caption` 等），不在页面里逐条拼字号与字重。
- 颜色、圆角、阴影、模糊、语义层级、面板尺寸、图标尺寸与动效时长都有对应映射：`tw:bg-app-*`、`tw:rounded-control`、`tw:shadow-md`、`tw:z-popover`、`tw:max-w-conversation`、`tw:size-icon-md`、`tw:duration-state`。
- 普通间距沿用 4px 刻度：`--cpx-sys-space-N` 对应 `tw:gap-N` / `tw:px-N`。不在刻度上的控件几何用命名间距条目，例如 `--spacing-control-block: var(--cpx-comp-input-padding-block)` → `tw:py-control-block`。
- 每个 utility 与变体都必须带 `tw:` 前缀，且前缀在最前（`tw:hover:bg-app-hover`、`tw:data-[expanded=false]:grid-rows-[0fr]`）。漏写时 Tailwind 不报错也不生成规则，契约检查会直接失败。
- 无法用 utility 表达的规则（伪元素、`color-mix` 计算的表面、需要被 `transitionend`/`getComputedStyle`/测试读取的属性、第三方生成 DOM）写入 `src/styles/primitives/<name>.css`，由 `src/styles/tailwind.css` 加载到 `primitives` 层，并在文件头注释说明原因。

## 自动契约与例外

`scripts/check-style-contracts.ts` 的 `featureTokenContract` 扫描 `src/styles/features`、`src/styles/lazy` 下的残留 CSS、TS/TSX inline style 和 Tailwind arbitrary value，并验证例外重复与 stale 状态。同一脚本还校验 `tw:` 前缀、`type-*` 与 `tw:type-weight-*` 的组合、全源动效契约、单一样式入口图（`src/styles/tailwind.css`）与 `@layer` 顺序。Renderer 已不再编译 Sass：所有样式都是原生 CSS。

例外必须同时包含文件、属性、精确值和具体原因。可接受场景包括 Diff 行号的 `ch` 对齐、运行时拖拽边界、图表坐标、动态色板对比描边和第三方内部尺寸。不能因为迁移困难、希望保留任意历史像素或检查失败而新增例外。

## 示例

```tsx
<div
  className={cx(
    'feature-toolbar tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:rounded-control tw:z-sticky',
    'tw:transition-opacity tw:duration-state tw:ease-standard',
  )}
>
  <h2 className="feature-title tw:type-title-sm tw:text-app-text">{title}</h2>
  <p className="feature-description tw:type-body-sm tw:text-app-text-soft">{description}</p>
  <span className="feature-meta tw:type-caption tw:text-app-text-meta">{count}</span>
</div>
```

```css
/* 只在 utility 表达不了时使用：运行时几何、第三方 DOM、伪元素。 */
@layer primitives {
  .feature-empty-state {
    --empty-state-padding: clamp(var(--cpx-sys-space-3), 4vh, var(--cpx-sys-space-6));

    padding: var(--empty-state-padding);
  }
}
```
