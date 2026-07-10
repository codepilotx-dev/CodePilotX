# 插件设置页改造实施计划

## Summary
- 把 `apps/desktop/src/renderer/features/settings/McpSettings.tsx` 升级为新的 `PluginSettings.tsx`，按原型做 4 个 Tab：`插件`、`应用`、`MCP`、`技能`。
- 侧边栏 `集成` 分组：保留现有 `mcp` 的路由兼容性入口 (`#/settings?tab=mcp`)，但展示名改为 `插件`，并新增 `apps` 隐藏入口或合并逻辑。
- 旧 `McpSettings.tsx` 作为兼容壳仅保留 `tab=mcp` 的入口映射和回退，最终被 `PluginSettings.tsx` 内部默认渲染。
- 所有读 / 写全部走 `rust/codex-rs/app-server`（plugin / app / skills / mcp 已有 / 新增的 endpoints），不再依赖 `apps/desktop/src/main/mcpSettingsService.ts` 中的旧 TS MCP config 服务作为数据源。`mcpSettingsService.ts` 仍可作为开发期 / Rust 端缺失能力时的回退实现，由依赖注入决定走哪条路径。

## 当前状态要点（审计结论）

### 1. Rust 端已有 endpoints
- `plugin/list`、`plugin/installed`、`plugin/install`、`plugin/uninstall`、`plugin/read`、`plugin/skill/read`、`plugin/share/*` 全部已存在（`common.rs` 第 466–1220 区段；处理器 `app-server/src/request_processors/plugins.rs`）。
- `app/list`、`app/list/updated` 已存在；写 `apps.<id>.enabled` 当前由 TUI 通过 `config/value/write` 实现（`tui/src/app/background_requests.rs:1139-1158`，`tui/src/config_update_tests.rs:10`）。
- `skills/list`、`skills/extraRoots/set`、`skills/config/write` 已存在（`common.rs:657-784`，`protocol/v2/plugin.rs`）；`skillsChanged` 通知已存在。Skills 目录 / install 端点 Rust 端尚无，TS 侧 `apps/desktop/src/main/skillsCatalogService.ts` 仍负责 skills.sh 拉取与安装文件落盘（`getOpenAgentConfigHomeDir() + skills/<slug>/SKILL.md`）。
- `mcpServerStatus/list`、`config/mcpServer/reload`、`mcpServer/oauth/login` 等运行时 endpoints 已存在；运行态只读。
- `config/read`、`config/value/write`、`config/batchWrite` 是底层配置写入引擎，但 `ConfigManager::apply_edits` 写只走 user 层（`app-server/src/config_manager_service.rs:198-212`）。

### 2. Rust 端缺口（需在本次实施内补齐）
- `mcpServerConfig/list` / `mcpServerConfig/save` / `mcpServerConfig/remove` / `mcpServerConfig/enabled/set` 四个新方法，目前**完全没有**：
  - 没有 wire-level 类型（`protocol/v2/mcp.rs` 内未声明这些 Params / Response）。
  - 没有 `ClientRequest` 变体（`common.rs:466-1220`）。
  - 没有可写多 scope 的写入路径：`ConfigEditsBuilder` (`config/src/mcp_edit.rs:75-86`) 只能重写整个 `mcp_servers` 表；`ConfigManager::write_value` (`config_manager_service.rs:169-212`) 只允许 user 层。
  - 没有 `McpScope` enum（layer 由 `ConfigLayerSource` 表达，但 MCP 路径尚无 wire-level scope）。
  - 没有 list-by-layer API（`list_mcp_server_status` 只返回 effective servers，不带 source）。
- 同样缺：`plugin/enable`、`plugin/disable`、`plugin/enabled/set`（TUI 当前用 `config/value/write`，但 app-server 不暴露方法）。
- 没有 `app/setEnabled` 这种专用方法；TUI 用 `config/value/write` 写 `apps.<id>.enabled`。
- 决策：本计划**只补齐 MCP 多 scope endpoints**（计划核心范围）。plugin / app 端点暂时沿用 `config/value/write`（已存在），不增加新方法；后续若需要再单独立项。

### 3. Desktop 端当前 surface
- `RustAppServerClient`（`apps/desktop/src/main/rustAppServerClient.ts`）目前**没有** plugin / app / skills / mcp 方法，只有 `reloadMcpConfig()` 调用 `config/mcpServer/reload`。
- `RustAppServerControlService`（`apps/desktop/src/main/rustAppServerControlService.ts`）只面向 thread 管理，不含上述业务能力。
- `desktopClient`（`apps/desktop/src/renderer/services/desktopClient.ts`）已经定义了完整 plugin / skill / mcp API surface，但实现是 mock。
- 旧实现：plugin 用 `apps/desktop/src/main/index.ts:1724/1789` 的本地函数（`listBuiltinPlugins` / `setBuiltinPluginEnabled`）；MCP 用 `mcpSettingsService.ts`（依赖 `@codepilotx/core/services/mcp/config.js` 的 `getAllMcpConfigs / addMcpConfig / removeMcpConfig / setMcpServerEnabled / isMcpServerDisabled`）；skill 用 `skillsCatalogService.ts`。
- `desktopApiSchema.ts` 已经定义了 `listBuiltinPlugins`、`setBuiltinPluginEnabled`、`listSkillsCatalog`、`installSkill`、`listMcpServers`、`saveMcpServer`、`removeMcpServer`、`setMcpServerEnabled`、`reloadMcpConfiguration` 的 zod schema。`ipcChannels.ts` 也有对应常量。

### 4. 路由
- `SettingsLayout` 用 `useSearchParams` 读 `tab`，默认 `general`。
- `DesktopLayout.tsx:1550-1556` 的 `handleSettingsTabChange` 用 `navigate('/settings?tab=...')`。
- `SettingsNav` 集成分组包含 `{ id: 'mcp', label: 'MCP 服务器' }`、`{ id: 'browser' }`、`{ id: 'computer' }`。

---

## Key Changes

### A. Rust app-server：新增 MCP 多 scope config endpoints

文件改动集中在 `rust/codex-rs/app-server-protocol/src/protocol/v2/mcp.rs`、`common.rs`、`app-server/src/message_processor.rs`、`app-server/src/request_processors/mcp_processor.rs`。

1. **新 wire-level scope enum**：`McpScope { User, Project, Local, SessionFlags, System }`（v2 `protocol/v2/mcp.rs`）。`McpLayerSource` 用于 list 结果里只读 scope 标注（`Plugin`、`Enterprise`、`Managed`、`Dynamic`、`ClaudeAi` 等），与 `ConfigLayerSource`（`protocol/v2/config.rs:28-97`）对应但简化为 wire DTO。
2. **新 Params / Response**：
   - `McpServerConfigListParams { cwd?: AbsolutePathBuf }` → `McpServerConfigListResponse { data: Vec<McpServerConfigEntry { name, scope, type, summary, enabled, editable, removable, source: McpLayerSource, config }> }`
   - `McpServerConfigSaveParams { cwd?: AbsolutePathBuf, originalName?: string, name, scope: McpScope, config: McpServerConfig }` → `McpServerConfigSaveResponse { entry: McpServerConfigEntry }`
   - `McpServerConfigRemoveParams { cwd?: AbsolutePathBuf, name, scope: McpScope }` → `McpServerConfigRemoveResponse {}`
   - `McpServerConfigEnabledSetParams { cwd?: AbsolutePathBuf, name, scope: McpScope, enabled }` → `McpServerConfigEnabledSetResponse { entry: McpServerConfigEntry }`
3. **新 `ClientRequest` 变体**（`common.rs` `#[ts(...)]` 宏块）：`McpServerConfigList`、`McpServerConfigSave`、`McpServerConfigRemove`、`McpServerConfigEnabledSet`，wire name `mcpServerConfig/list`、`mcpServerConfig/save`、`mcpServerConfig/remove`、`mcpServerConfig/enabled/set`。
4. **更新 `EXPERIMENTAL_CLIENT_METHODS`**（`common.rs:400`）和 `client_request_methods`（`export.rs:2915-2927`）allowlist。
5. **新处理器**（`request_processors/mcp_processor.rs`）：
   - `list_mcp_server_configs`：解析 cwd → `ConfigLayerStack::load(cwd)`（`config/src/loader.rs`），遍历每个 layer 的 `mcp_servers` 表，对每条记录产出 `(name, scope=layer, source, config)`。`pluginSource` / `enterprise` / `managed` 等 readonly 源对应 `editable=false, removable=false`，开关 UI 仅显示不可编辑。
   - `save_mcp_server_config`：根据 `scope` 定位文件并写入：
     - `User` → `~/.codepilotx/config.toml` 的 `[mcp_servers]` 表（可复用现有 `ConfigEditsBuilder` 的按名 set / remove：`replace_mcp_servers` 接受完整 map，新增 `set_mcp_server(name, config)` + `remove_mcp_server(name)` 帮手函数）。
     - `Project` → 从 cwd 向上找 `.codepilotx/config.toml`（或 `config.toml`），不存在则创建。
     - `Local` → `<cwd>/.mcp.json`，沿用 CLI 现有 `.mcp.json` 解析 / 写回（参考 `cli/src/mcp_cmd.rs:276-441` 的逻辑；写到本地项目配置层文件）。
     - `SessionFlags` / `System` → 直接报错 `ReadOnlyLayer`。
     - `originalName` 改变时：先 remove 再 add；失败回滚。
   - `remove_mcp_server_config`：按 `(name, scope)` 删除对应文件 / 表项。readonly scope 拒绝。
   - `set_mcp_server_config_enabled`：写对应文件的 `enabled` 字段。readonly scope 拒绝。
6. **完成后自动触发** `config/mcpServer/reload`（已存在的 `mcp_refresh::queue_strict_refresh`）。
7. **测试**（`app-server/tests/suite/v2/mcp_server_config.rs`，新增）：
   - user scope save / remove / enabled-set 成功，生成文件内容正确。
   - project / local scope 写入 `<cwd>/.codepilotx/config.toml` / `<cwd>/.mcp.json` 正确。
   - readonly scope（enterprise / plugin / claudeai / dynamic）拒绝修改并返回 `ConfigLayerReadonly` 风格的错误码。
   - rename 失败回滚（save 后旧条目消失、新条目出现）。
   - reload 后 `mcpServerStatus/list` 能看到新条目。

### B. Desktop main process

1. `apps/desktop/src/main/rustAppServerClient.ts` 新增 4 个 typed 方法：`listMcpServerConfigs(params)`、`saveMcpServerConfig(params)`、`removeMcpServerConfig(params)`、`setMcpServerConfigEnabled(params)`。返回类型先放在本地，待 Rust 端 schema 生成后切到 `generated/v2` 复用。
2. `apps/desktop/src/main/rustAppServerControlService.ts` 扩展 `RustAppServerControlClient` 类型并新增便捷方法（`listAllMcpServerConfigs` 等），复用现有 `withControlConnection` 模板。Plugin / app / skills 暂时不动，仍走 `index.ts` 内的旧实现 + 后续替换。
3. `apps/desktop/src/main/index.ts`：
   - `listMcpServers` / `saveMcpServer` / `removeMcpServer` / `setMcpServerEnabled` 改为优先用 `RustAppServerControlService`；当 Rust 端 `method_not_found` 或 app-server 不可用时，回退到 `mcpSettingsService.ts` 的旧实现（保留向后兼容）。
   - 旧 service 文件保留，不删除。注释明确"primary path is Rust app-server; fallback only when Rust unavailable"。
4. 新增 `apps/desktop/src/main/pluginsService.ts`（可选）：包装 `plugin/list`、`plugin/install`、`plugin/uninstall`、`plugin/enable|disable`（Rust 端暂无 enable 端点，先用 `config/value/write` 写 `plugins.<id>.enabled`，记录为 TODO）。后续随 Rust 端 plugin endpoints 补齐替换。
5. 新增 `apps/desktop/src/main/appsService.ts`（可选）：`listApps` 用 Rust `app/list`，`setAppEnabled` 用 `config/value/write` 写 `apps.<id>.enabled`。
6. `desktopApiHandlers.ts`（已存在）按依赖注入接通新的 services；`desktopApiHandlers.test.ts` 注入 mocks。
7. `desktopApiSchema.ts`、`ipcChannels.ts`：现有 schema 满足需要；不需要新增 wire-level 字段。确保 `setMcpServerEnabled` 接受 `scope` 参数（schema 需扩展 `enabledSet` 形式，见 §D）。

### C. Renderer

1. 新建 `apps/desktop/src/renderer/features/settings/PluginSettings.tsx`（替换 `McpSettings.tsx` 在 SettingsPage 中的渲染）：
   - 顶部 `settings-page-header`：标题 `插件`，副标题 `管理插件、技能和 MCP`。
   - 4 个内部 Tab（SegmentedControl 或自定义 button group）：`插件` / `应用` / `MCP` / `技能`，对应 state `pluginTab`。
   - 共用 `SettingsRow`、`ToggleSwitch`、`SettingsDropdown`、`SettingsSection`、`SettingsContentArea`、搜索框 input 风格。
   - 列表行统一为 `左侧 icon + 名称 + 描述 / scope 文案 | 右侧 设置按钮 + ToggleSwitch`。
2. `SettingsPage.tsx`：
   - `if (activeTab === 'mcp' || activeTab === 'plugins') return <PluginSettings />`。
   - 删除 `McpSettings` import。
3. `SettingsNav.tsx`：
   - `集成` 分组将 `{ id: 'mcp', label: 'MCP 服务器' }` 替换为 `{ id: 'plugins', label: '插件' }`。
   - `browser` / `computer` 保持不动。
   - `McpSettings` 文件可保留作为内部组件复用（如 `McpSettingsPanel`），或直接并入 `PluginSettings.tsx` 的 MCP Tab（推荐）。
4. `apps/desktop/src/renderer/services/desktopClient.ts`：现有 mock 保留；现有 typed surface（`listBuiltinPlugins`、`setBuiltinPluginEnabled`、`listSkillsCatalog`、`installSkill`、`listMcpServers`、`saveMcpServer`、`removeMcpServer`、`setMcpServerEnabled`、`reloadMcpConfiguration`）保持不变，TS 类型对齐 §A 中 Rust 返回结构。
5. `apps/desktop/src/renderer/styles/features/settings.scss`：保留现有 `.mcp-server-row` 等样式作为 MCP Tab 内部使用；新增 `.plugin-settings-tabs`、`.plugin-settings-tab`、`.plugin-row` 等需要 token 化的样式，复用现有 `--space-*`、`--font-size-*`、`--color-text-*`、`--radius-*`、`--layout-card-pad` 变量。

### D. 数据流契约

- `DesktopMcpServerListItem`（`shared/types.ts:722-731`）保留并扩展 `source?: McpLayerSource`、`scope` 字段允许 `user | local | project | enterprise | managed | dynamic | claudeai | plugin`。`editable` / `removable` 由 Rust 决定。
- `SaveDesktopMcpServerOptions`（`shared/types.ts:760-765`）保留。
- 新增 `SetMcpServerEnabledOptions { name, scope, enabled }`（用于 enable 调用），`desktopApiSchema.ts` 对应 zod；`setMcpServerEnabled` 旧签名继续保留作为 fallback 路径。
- `DesktopSkillListItem`（用于 skills Tab 真实已装技能 + Rust 端 skills/list 返回数据，新增）：
  - `name`、`description`、`path`、`scope: SkillScope`、`enabled`、`cwd?`。

---

## UI Behavior

### 顶部 + Tab
- 标题 `插件`，副标题 `管理插件、技能和 MCP`。
- Tab 顺序固定：`插件` → `应用` → `MCP` → `技能`。
- Tab 切换不卸载其他 Tab 的查询状态，每个 Tab 内部维护自己的 query / loading / error。
- Tab 上方有全局搜索框，对当前 Tab 的 name + description 过滤；列表计数显示在 section header 旁。

### 插件 Tab
- 数据源：`plugin/list`（Rust 已存在）+ `plugin/installed` 合并 + `config/value/write` 读 `plugins.<id>.enabled`（或后续 Rust `plugin/enabled/set`）。
- 行：`icon | 名称 + 描述 | scope chip | toggle`。
- 开启=install（`plugin/install`），关闭=`plugin/uninstall`。若 Rust 返回 `install_policy` 字段为 `enabled_set`，改为调 enable/disable 端点。
- 加载 / 错误状态用 `SettingsSection` 的 description 区域。

### 应用 Tab
- 数据源：`app/list`（Rust 已存在），从返回里读 `is_enabled`。
- 行：`icon | 名称 + 描述 | scope chip | toggle`。
- toggle 写 `apps.<id>.enabled`：先用 `config/value/write`（已存在），写完刷新 `app/list`。
- 后续若 Rust 补 `app/setEnabled`，替换之。

### MCP Tab
- 数据源：`mcpServerConfig/list`（新增），runtime 状态走 `mcpServerStatus/list`（已存在）。
- 行：`icon | 名称 + 描述 | scope chip + source chip | toggle | 编辑按钮 | 删除按钮`。
- 搜索框过滤 name / type / scope。
- `+ 添加服务器` 按钮触发同一 `SettingsSection` 表单（保留现有 `McpSettings` 的 Name / Scope / Template / JSON 编辑样式）。
- 表单 submit 调 `mcpServerConfig/save`；删 = `mcpServerConfig/remove`；toggle = `mcpServerConfig/enabled/set`。
- readonly scope（plugin / enterprise / managed / dynamic / claudeai）的行整体 disabled，icon 显示锁。
- 任何写操作完成后调 `config/mcpServer/reload`（`reloadMcpConfiguration()`）。

### 技能 Tab
- 数据源：`skills/list`（Rust 已存在，含 `cwd`、`skills[]`、`scope`、`enabled`、`path`）+ `listSkillsCatalog`（保留 Vercel OIDC 路径，用于"发现更多技能"） + `installSkill`（TS 本地 `skillsCatalogService`）。
- 内部 SegmentedControl：`已安装` / `浏览技能`。
- 已安装列表：`skills/list` 数据，行 = `icon | 名称 + 描述 + scope chip | toggle`；toggle = `skills/config/write`（按 `path` 或 `name`）。
- 浏览列表：现有 `listSkillsCatalog` + 搜索 + `installSkill`。

### 通用
- 表单 / 错误提示走 `SettingsSection` 的 description；删除前 `window.confirm`（沿用现有 MCP 行为）。
- 任意写操作 `busy=true`，错误时显示在 description，状态成功时 `setStatus` 一行绿色提示（沿用现有 `McpSettings` 模式）。

---

## Test Plan

### Rust
- `app-server/tests/suite/v2/mcp_server_config.rs`（新增）：
  - user / project / local save + remove + enabled set 各一条 happy path。
  - readonly scope（enterprise / plugin / dynamic）save / remove / enabled set 均返回 `ConfigLayerReadonly` 错误。
  - rename 失败回滚：故意构造 save 失败，验证原条目仍在且 reload 不丢失。
  - reload 触发：`config/mcpServer/reload` 被调用，`mcpServerStatus/list` 返回包含新条目。
- `config/src/mcp_edit.rs`：新增 `set_mcp_server`、`remove_mcp_server` 单元测试，验证 partial 写入不破坏其他条目。
- `core/src/config/edit.rs`：对应 `ConfigEdit::SetMcpServer`、`ConfigEdit::RemoveMcpServer`（如选择走 batch write）。

### Desktop main
- `apps/desktop/src/main/desktopApiHandlers.test.ts`：新增 pluginsService / appsService / mcpServerConfig 服务注入；mock 验证：
  - `listMcpServers` 优先用 Rust control service；Rust 抛 `method_not_found` 时回退到 `mcpSettingsService`。
  - `saveMcpServer`、`removeMcpServer`、`setMcpServerEnabled` 走 Rust control service 路径，并参数化 scope / name / config。
  - `listBuiltinPlugins` / `setBuiltinPluginEnabled` / `listSkillsCatalog` / `installSkill` 沿用旧实现 + 注入。
- `apps/desktop/src/main/rustAppServerControlService.test.ts`：扩展 `configureClient` 场景覆盖新增的 4 个 mcpServerConfig 方法。
- `apps/desktop/src/main/rustAppServerClient.test.ts`：补 4 个方法的对端协议断言（method 名、payload shape）。

### Renderer
- `apps/desktop/src/renderer/features/settings/PluginSettings.test.tsx`（新建）：
  - 4 个 Tab 切换渲染对应内容。
  - 搜索过滤影响当前 Tab 的列表数。
  - toggle 调用对应 desktopClient 方法；busy / error 状态显示。
- `apps/desktop/src/renderer/features/settings/SettingsPage.test.tsx`：补 `activeTab='plugins'` 分支，断言渲染 `PluginSettings`。
- 视觉检查：`bun run desktop:css:check` 通过；不要新增未被 token 覆盖的硬编码颜色 / 间距。

### 手动 QA
- 进入 `#/settings?tab=mcp`，确认进入新的 `插件` 页。
- 切换 4 个 Tab：插件 / 应用 / MCP / 技能，确认布局、间距、开关、加载状态、错误状态。
- 在 MCP Tab 添加一个 stdio server，确认文件落盘正确（`~/.codepilotx/config.toml` 或 `<cwd>/.mcp.json`）。
- 切到 readonly scope 行，确认 toggle / 编辑 / 删除均禁用。
- 切到技能 Tab，调出 skills 列表，启用 / 禁用一个技能，确认 `skills/config/write` 生效。

---

## Assumptions

- Rust app-server 是所有写操作的单一来源；TS 端仅做 UI / 表单 / IPC 转发。
- 旧 `mcpSettingsService.ts` 与 `@codepilotx/core/services/mcp/config.js` 在 Rust 端能力补齐前作为 fallback；本次不删除旧文件，但 PluginSettings 不直接依赖它。
- 本次不在 Rust 端新增 `plugin/enable|disable|enabled/set` 与 `app/setEnabled`；先用已存在的 `config/value/write` 实现 toggle，写入路径仍然收敛到 Rust。
- 本次不修改 `plugin/install` / `plugin/uninstall` 的现有语义；如果某插件返回 `install_policy=enabled_set`，UI 提示"该插件以 enable/disable 控制"并显示但暂时禁用 toggle（后续 Rust 端补 enable 端点）。
- 路由层保持 `#/settings?tab=mcp` 兼容；新主入口 `#/settings?tab=plugins` 等价。tab=mcp 在旧 McpSettings 卸载后会被路由到 `PluginSettings`，URL 不变。
- 不引入新全局样式；复用 `--space-*`、`--color-*`、`--layout-*`、`--radius-*` 等 token。
- 不引入 Skills Catalog 的 Rust 实现；`listSkillsCatalog` / `installSkill` 继续走 TS 本地 `skillsCatalogService.ts`（基于 skills.sh + VERCEL_OIDC_TOKEN）。
- Skills Tab 数据完全靠 Rust `skills/list` + 已有 `skills/config/write`；`listSkillsCatalog` 仅作为 `Browse` 分支的发现入口。

---

## File Inventory（执行清单）

Rust：
- `rust/codex-rs/app-server-protocol/src/protocol/v2/mcp.rs`（新增 4 对 Params/Response + McpScope / McpLayerSource / McpServerConfigEntry）
- `rust/codex-rs/app-server-protocol/src/protocol/common.rs`（新增 4 个 ClientRequest 变体 + 改 EXPERIMENTAL_CLIENT_METHODS）
- `rust/codex-rs/app-server-protocol/src/export.rs`（client_request_methods allowlist）
- `rust/codex-rs/app-server/src/message_processor.rs`（dispatch 路由）
- `rust/codex-rs/app-server/src/request_processors/mcp_processor.rs`（4 个新处理器）
- `rust/codex-rs/config/src/mcp_edit.rs`（新增 set_mcp_server / remove_mcp_server partial helpers）
- `rust/codex-rs/core/src/config/edit.rs`（按需新增 SetMcpServer / RemoveMcpServer ConfigEdit）
- `rust/codex-rs/app-server/src/mcp_refresh.rs`（save/remove/enabled-set 后触发 reload）
- `rust/codex-rs/app-server/tests/suite/v2/mcp_server_config.rs`（新增测试套件）

Desktop main：
- `apps/desktop/src/main/rustAppServerClient.ts`（4 个新 typed 方法）
- `apps/desktop/src/main/rustAppServerControlService.ts`（扩展 client + service）
- `apps/desktop/src/main/index.ts`（listMcpServers / save / remove / setEnabled 改走 Rust + fallback）
- `apps/desktop/src/main/desktopApiHandlers.ts`（接入 services）
- `apps/desktop/src/main/desktopApiHandlers.test.ts`（注入 mock 补 case）
- `apps/desktop/src/main/mcpSettingsService.ts`（保留并加注释说明当前为 fallback）

Renderer：
- `apps/desktop/src/renderer/features/settings/PluginSettings.tsx`（新增，4 Tab）
- `apps/desktop/src/renderer/features/settings/PluginSettings.test.tsx`（新增）
- `apps/desktop/src/renderer/features/settings/McpSettings.tsx`（保留为旧入口 / 兼容，可内部复用）
- `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`（activeTab 路由改 plugins → PluginSettings）
- `apps/desktop/src/renderer/features/settings/SettingsPage.test.tsx`（断言 plugins 分支）
- `apps/desktop/src/renderer/features/settings/SettingsNav.tsx`（集成分组改为 `id: 'plugins', label: '插件'`）
- `apps/desktop/src/renderer/services/desktopClient.ts`（现有 surface 已支持；按需补 setEnabled 接受 scope）
- `apps/desktop/src/shared/types.ts`（扩展 DesktopMcpServerListItem source，新增 SetMcpServerEnabledOptions、DesktopSkillListItem）
- `apps/desktop/src/shared/desktopApiSchema.ts`（按需扩展 setMcpServerEnabled zod 接受 scope）
- `apps/desktop/src/shared/ipcChannels.ts`（按需新增 enabledSet channel）
- `apps/desktop/src/renderer/styles/features/settings.scss`（新增 `.plugin-settings-tabs` 等 token 化样式）

Reference（参考）：
- 旧 TS MCP 服务：`apps/desktop/src/main/mcpSettingsService.ts`（保留作为 fallback + 行为对照）
- 旧 PluginsView：`apps/desktop/src/renderer/features/plugins/PluginsView.tsx`（视觉风格参考，不并入）
- TUI 端 plugin enable 写 `plugins.<id>`：`rust/codex-rs/tui/src/app/background_requests.rs:1139-1158`
- TUI 端 apps enabled 写 `apps."<id>".enabled`：`rust/codex-rs/tui/src/config_update_tests.rs:10`