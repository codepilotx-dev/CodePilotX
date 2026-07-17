# Codex 主题切换与模式过滤排查

## DEBUG REPORT

- **Symptom**：外观设置中的代码高亮主题看起来无法可靠切换；Light / Dark 模式没有过滤反色主题；System 模式无法同时保存一套浅色选择和一套深色选择。
- **Root cause**：
  1. `AppearanceSettings` 在模块加载时构造了包含全部 91 个主题的固定选项，没有读取当前实际生效的 Light / Dark 模式。
  2. 主题生成器虽然已把 signature 主题对象恢复为明确的 `type: light | dark`，但 manifest 元数据仍取扫描清单中的旧 `unknown`，导致 13 个主题的分类证据丢失。
  3. V2 设置只有单个 `codeThemeId`，无法表达 System 模式需要的浅色、深色两套选择。
  4. `resolveThemeId` 只校验 slug 是否存在，没有校验它是否与当前 UI 模式兼容。
- **Fix**：
  1. manifest 改用规范化主题对象的最终 `type`，91 个主题现在全部具有明确的 light/dark 分类。
  2. V2 设置改为 `codeThemeIds.light` 和 `codeThemeIds.dark` 两个持久化槽位；旧单槽位 V2 设置自动迁移到主题类型对应的槽位。
  3. Light / Dark 模式只显示对应类型的选择器；System 模式同时显示浅色和深色选择器，系统外观变化时应用对应槽位。
  4. 新增统一的主题兼容性、过滤和归一化函数；不兼容或非法的选择回退到对应槽位的 `auto`。
- **Evidence**：
  - 同一段 TypeScript 使用 `codex-dark`、`dracula`、`tokyo-night`、`codex-light`、`github-light` 高亮时，Shiki 返回了不同的背景色、前景色和 token 颜色。
  - `themes:codex:check` 验证 91 个逻辑主题和 151 个物理模块生成结果稳定。
  - renderer 主题、高亮、样式检查与完整测试通过。
  - 全量类型检查被同时存在的 Right Dock / Environment 未完成改动阻塞；报错文件不在本次主题修改范围。
- **Regression test**：
  - `apps/desktop/renderer/test/syntax-theme.test.ts`：验证 91 个主题全部具有明确分类、选择器按模式过滤、反色主题回退。
  - `apps/desktop/renderer/test/syntax-highlighter.test.ts`：验证切换主题后返回新的背景色和 token 色，而非复用旧结果。
- **Related**：问题来自 Codex 主题系统一次性重建提交 `c1a5835`；高亮器动态加载和缓存键本身工作正常。
- **Status**：DONE_WITH_CONCERNS
