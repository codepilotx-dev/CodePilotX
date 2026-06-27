# 引入 Radix Themes 圆角规则 - Settings 试点

## Summary
- 按 Radix UI Themes 圆角规范改造桌面端样式系统。
- 第一阶段：CSS token 全局迁移，把 `--r-*` 和硬编码 `border-radius` 收编到 6 步 scale，base.css 写 fallback 让所有页面无依赖 Theme 也能工作。
- 第二阶段：仅在 Settings 路由包 `<Theme radius="medium">`，验证 Theme 注入与现有 base.css 不打架。
- 第三阶段：拍板是否推广到整个 App，并处理 30px 那两处遗留。

## 范围
- 只引入圆角规则，不替换任何现有组件为 Radix Themes 组件。
- 不接入主题设置中的 radius factor 切换，保持 medium 静态。
- 不动 `--fs-*` 字号体系、`@radix-ui/colors` 色板。
- 不动 `apps/tui/` 终端 UI。
- 试点入口：`SettingsLayout`（包整个 `/settings` 路由，含 GlobalErrorModal）。
- 30px 那两处（`composer.css:684`、`session.css:1611`）暂不处理，留到第三阶段。

## Phase 1: CSS token 全局迁移

### 1.1 `apps/desktop/src/renderer/styles/base.css`
- 删除第 48–53 行的 `--r-sm/md/lg/pill/card/round`。
- 替换为 Radix 风格 token 块：
  ```css
  :root {
    --radius-factor: 1;
    --radius-1: calc(4px  * var(--radius-factor));
    --radius-2: calc(6px  * var(--radius-factor));
    --radius-3: calc(8px  * var(--radius-factor));
    --radius-4: calc(10px * var(--radius-factor));
    --radius-5: calc(12px * var(--radius-factor));
    --radius-6: calc(16px * var(--radius-factor));
    --radius-full: 9999px;
    --radius-thumb: max(var(--radius-factor) * 9999px, 50%);
  }
  ```
- `base.css:224` `border-radius: 999px` → `var(--radius-full)`。
- `base.css:256` `var(--r-md)` → `var(--radius-3)`。
- 末尾追加 `.r-none/.r-small/.r-medium/.r-large/.r-full` 工具类。

### 1.2 批量替换 CSS 引用
- `--r-sm` → `--radius-2`
- `--r-md` → `--radius-3`
- `--r-lg` → `--radius-5`
- `--r-pill` → `--radius-6`
- `--r-round` → `--radius-full`
- 删除未使用的 `--r-card` 定义。
- 兜底：`grep -rn "var(--r-" apps/desktop/src` 应为 0。

### 1.3 收编硬编码 `border-radius: Npx`
- 4px → `var(--radius-1)`
- 5px → `var(--radius-1)` (缩 1px)
- 6px → `var(--radius-2)`
- 8px → `var(--radius-3)`
- 9px → `var(--radius-3)` (缩 1px)
- 10px → `var(--radius-4)`
- 11px → `var(--radius-4)` (缩 1px)
- 12px → `var(--radius-5)`
- 14px → `var(--radius-5)` (缩 2px)
- 15px → `var(--radius-6)` (增 1px)
- 16px → `var(--radius-6)`
- 17px → `var(--radius-6)` (缩 1px)
- 18px → `var(--radius-6)` (缩 2px)
- 24px → `var(--radius-6)` (缩 8px)
- 999px → `var(--radius-full)`
- `50%` / `inherit` / 4-tuple / 含 `!important` 的：原样保留
- `border-radius: 18px !important;` 改写为 `border-radius: var(--radius-6) !important;`

### 1.4 验证
- `bun run desktop:typecheck`
- 启动 `bun run desktop:dev` 走全页面，目测零视觉变化。
- `grep -rn "var(--r-" apps/desktop/src` → 0
- `grep -rn "border-radius: [0-9]" apps/desktop/src` → 仅剩 `30px` 两处 + 允许情形。

## Phase 2: 包 Settings 进 Theme

### 2.1 添加依赖
- 根 `package.json` 加 `"@radix-ui/themes": "^3.1.6"` 到 `dependencies`。
- `bun install`（环境不可用则在 handoff 中标注）。

### 2.2 改造 `SettingsLayout.tsx`
```tsx
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'

export function SettingsLayout() {
  // ...原有 state...
  return (
    <Theme
      radius="medium"
      hasBackground={false}
      panelBackground="translucent"
      scaling="100%"
    >
      <div className="settings-page">
        <GlobalErrorModal ... />
        <SettingsPage ... />
      </div>
    </Theme>
  )
}
```

### 2.3 冒烟清单
- `/settings` 11 个子页面切换。
- Connections → 打开 ModelProvider 下拉（popover 圆角）。
- 触发任意 error notice（modal 圆角）。
- Appearance → 切换浅色/深色/dracula。
- ColorPicker、SegmentedControl、ToggleSwitch、Slider 视觉无变化。
- DevTools 抽测：`getComputedStyle(el).borderRadius` 在 Settings 内解析为 `8px`（`--radius-3`），切到 `/quick-chat` 仍是 `8px`（base.css fallback 生效）。

### 2.4 冲突处理预案
- 按钮重置被 Radix 改：Theme 上加 `appearance` 或局部类覆盖。
- 字体栈被抢：Theme 上加 `style={{ '--default-font-family': 'MiSans' }}`。
- `box-sizing` 双声明：忽略，无害。

## Phase 3: 拍板
- **A. 全应用推广**（推荐）：Theme 上移到 `App.tsx`，删除 base.css 手写 token，处理 30px。
- **B. 保持 Settings 试点**：其它页继续 base.css fallback。
- **C. 回退 Theme**：卸依赖，保留阶段 1 改动。

## 不做的事
- 不替换任何现有组件为 Radix Themes 组件。
- 不接入 factor 切换。
- 不动字号、色板、阴影体系。
- 不动 `apps/tui/`、`packages/core/src/types/generated/`。

## 验证命令（共用）
- `bun run desktop:typecheck`
- `bun run desktop:dev` + 手动冒烟
- `grep -rn "var(--r-" apps/desktop/src` → 0
- `grep -rn "border-radius: [0-9]" apps/desktop/src` → 仅剩允许情形
