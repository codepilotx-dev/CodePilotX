# Rose Pine 内置主题设计

## 目标

在桌面端内置主题列表新增 Rose Pine 的浅色和深色预设，使用用户提供的精确配色。

## 方案

在 `apps/desktop/src/shared/theme.ts` 的 `DESKTOP_THEME_PRESETS` 中添加两个完整配置项：

- `light-rose-pine`，标签为 `Rose Pine`，`variant` 为 `light`。
- `dark-rose-pine`，标签为 `Rose Pine`，`variant` 为 `dark`。

两项都使用 `codeThemeId: "rose-pine"` 和共享的 `DEFAULT_FONTS`，使字体保持为全局默认值，不随主题切换。其余主题色严格使用用户提供的色值；深色预设保留亮的差异文字色，确保差异行可读。

## 兼容性与验证

这是一对新增 preset，不会修改现有 preset ID 或用户保存的覆盖配置。确认 TypeScript 配置结构无误，并运行可用的桌面主题相关校验；若无更窄的测试命令，则进行定向源码审查。
