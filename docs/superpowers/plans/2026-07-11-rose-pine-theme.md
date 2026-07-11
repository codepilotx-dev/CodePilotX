# Rose Pine 内置主题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面端内置主题中新增使用指定精确配色的 Rose Pine 浅色和深色 preset。

**Architecture:** `DESKTOP_THEME_PRESETS` 是内置主题的唯一注册表；在其中添加一对完整 `DesktopThemeConfigV1` 对象即可被现有设置页自动发现和按标签排序。对应单元测试维护主题套件数量及明确配色断言，防止配置以后被意外改回 Radix 生成色或自定义字体。

**Tech Stack:** TypeScript、Bun 测试、桌面端主题配置。

## Global Constraints

- 只修改桌面内置主题配置和直接覆盖此注册表的测试。
- 新增 ID 固定为 `light-rose-pine` 和 `dark-rose-pine`，标签均为 `Rose Pine`。
- 两项均使用 `codeThemeId: "rose-pine"`、`fonts: DEFAULT_FONTS` 与 `opaqueWindows: true`。
- 不改变任何既有 preset ID、用户保存的覆盖配置或设置页排序逻辑。
- 不改动 CSS，因此不运行 `bun run desktop:css:check`。

---

### Task 1: 注册并验证 Rose Pine 预设

**Files:**

- Modify: `apps/desktop/src/shared/theme.ts:302` — 在 Dracula preset 之后添加两项完整 Rose Pine 配置。
- Modify: `apps/desktop/src/shared/theme.test.ts:8-107` — 将 Rose Pine 纳入主题套件断言，并明确验证两项配置。

**Interfaces:**

- Consumes: `DEFAULT_FONTS` 和 `DESKTOP_THEME_PRESETS`，均定义于 `apps/desktop/src/shared/theme.ts`。
- Produces: 两个由 `getDesktopThemeEntry()` 和 Appearance 设置页读取的 `DesktopThemePreset` 项，ID 分别为 `light-rose-pine`、`dark-rose-pine`。

- [ ] **Step 1: 更新主题套件测试，使新增 preset 在实现前可被检测**

在 `THEME_SUITE_IDS` 的 `iris-focus` 前插入 `rose-pine`，并在 Dracula 配置测试后加入：

```ts
test('Rose Pine themes use configured desktop tokens and default fonts', () => {
  const lightPreset = DESKTOP_THEME_PRESETS.find(item => item.id === 'light-rose-pine')
  const darkPreset = DESKTOP_THEME_PRESETS.find(item => item.id === 'dark-rose-pine')

  expect(lightPreset?.config).toMatchObject({
    codeThemeId: 'rose-pine',
    theme: {
      accent: '#d7827e', contrast: 70, fonts: DEFAULT_FONTS, ink: '#575279',
      opaqueWindows: true,
      semanticColors: { diffAdded: '#56949f', diffRemoved: '#797593', skill: '#907aa9' },
      surface: '#faf4ed',
    },
    variant: 'light',
  })
  expect(darkPreset?.config).toMatchObject({
    codeThemeId: 'rose-pine',
    theme: {
      accent: '#ea9a97', contrast: 40, fonts: DEFAULT_FONTS, ink: '#e0def4',
      opaqueWindows: true,
      semanticColors: { diffAdded: '#9ccfd8', diffRemoved: '#908caa', skill: '#c4a7e7' },
      surface: '#232136',
    },
    variant: 'dark',
  })
})
```

同时将 `DEFAULT_FONTS` 加入测试文件的导入。

- [ ] **Step 2: 运行测试，确认当前实现不满足新增预设要求**

运行：`bun test apps/desktop/src/shared/theme.test.ts`

预期：失败，报告缺少 `light-rose-pine` 和 `dark-rose-pine` 或内置主题总数不匹配。

- [ ] **Step 3: 在主题注册表添加完整配置**

在 `dark-dracula` 之后、`DEFAULT_DARK_THEME_ID` 之前添加：

```ts
{
  id: "light-rose-pine",
  label: "Rose Pine",
  config: {
    codeThemeId: "rose-pine",
    theme: {
      accent: "#d7827e", contrast: 70, fonts: DEFAULT_FONTS, ink: "#575279",
      opaqueWindows: true,
      semanticColors: { diffAdded: "#56949f", diffRemoved: "#797593", skill: "#907aa9" },
      surface: "#faf4ed",
    },
    variant: "light",
  },
}
```

再添加 `dark-rose-pine`，将 `variant` 设为 `"dark"`，并使用：`accent: "#ea9a97"`、`contrast: 40`、`ink: "#e0def4"`、`diffAdded: "#9ccfd8"`、`diffRemoved: "#908caa"`、`skill: "#c4a7e7"`、`surface: "#232136"`。

- [ ] **Step 4: 运行目标测试与类型检查**

运行：`bun test apps/desktop/src/shared/theme.test.ts`

预期：全部通过，包括内置主题配对和 Rose Pine 精确 token 断言。

运行：`bun run desktop:typecheck`

预期：进程以状态码 0 退出。

- [ ] **Step 5: 审查差异并提交**

运行：`git diff --check` 和 `git diff -- apps/desktop/src/shared/theme.ts apps/desktop/src/shared/theme.test.ts`。

确认仅新增 Rose Pine preset 与相应测试后，运行：

```powershell
git add -- apps/desktop/src/shared/theme.ts apps/desktop/src/shared/theme.test.ts
git commit -m "feat(desktop)：新增 Rose Pine 内置主题"
```
