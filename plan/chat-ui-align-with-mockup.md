# Chat UI 对齐原型图 + Markdown 渲染修复

> 来源：对比 `我的项目.png` 与 `原型图.png`，并通读 `apps/desktop/src/renderer/` 下相关源码后整理。
> 状态：方案已确认，进入实施阶段。

---

## 一、差异清单

### A. 对话主区域顶部（`chat-session-header`）
| 项 | 原型图 | 当前实现 |
|---|---|---|
| 右侧工具栏 | **VS Code 图标**、**分屏图标**、**展开/全屏图标** 三个图标 | 只有 `MoreHorizontal` 一个图标 |

### B. AI 消息渲染（**最关键缺陷**）
`QuickChatView.tsx:172-197` 的 `renderSafeMarkdown` 是「土法解析」，**只支持** ```` ``` ```` 代码块 + 段落 + 换行。
原型图里 AI 的回复明显走了真正的 Markdown 渲染：

| Markdown 特性 | 当前 | 原型图所需 |
|---|---|---|
| 标题 `#` `##` `###` | ❌ | ✅ |
| 无序/有序列表 `-` `*` `1.` | ❌（原样输出） | ✅ |
| 加粗 `**text**` / 斜体 `*text*` | ❌ | ✅ |
| 行内代码 `` `code` `` | ❌ | ✅（原型里 `apps/`、`package.json` 这类是浅底圆角 pill） |
| 围栏代码块 + 语法高亮 | 部分（只 `<pre><code>` 无高亮） | ✅（带语言识别、高亮） |
| 表格 | ❌ | ✅ |
| 引用块 `>` | ❌ | ✅ |
| 链接 `[]()` | ❌ | ✅（可点击） |
| 流式增量（streaming）安全渲染 | ❌（每次 split 全文） | ✅ |
| XSS 防护 | 半套 | ✅（用已装的 `xss`） |

> 注：`package.json` **已依赖 `marked`、`xss`、`highlight.js`**，不需要新装包。

### C. 处理状态提示
| 原型图 | 当前 |
|---|---|
| AI 回复前显示 `✦ 已处理 5s ›`（可点开看处理步骤） | 灰字 `正在思考` |
| 侧栏部分会话项右侧有「转圈 spinner」 | 只有 `运行中` 文本 |

### D. Composer 底部行
| 项 | 原型图 | 当前 |
|---|---|---|
| **完全访问权限**提示 | 有，左侧橙色盾牌 + 文案 | 无（权限只在顶部 chip 里） |
| 模型 chip 文案 | 简洁：`5.5 高` | 冗长：`deepseek-v4-pro · 默认` |
| 麦克风按钮 | 不显眼 | 较大且和发送按钮并列 |

### E. 发送按钮
| 原型图 | 当前 |
|---|---|
| **圆形 + 向上箭头** (`ArrowUp`) | 圆形 + **纸飞机** (`Send`) |

### F. 用户消息气泡（深色主题下）
| 原型图 | 当前 |
|---|---|
| 浅灰/中性背景 + 深字 | `#3a2f44` 紫红底 + 白字（Dracula 偏色） |

### G. 侧栏 section-title
| 原型图 | 当前 |
|---|---|
| 12px / 500 / 大写字距 | 14px / 400 / 无字距 |

---

## 二、决策（已确认）

| 决策点 | 选择 |
|---|---|
| Markdown 方案 | 用已依赖的 `marked` + `xss` + `highlight.js`（零新增依赖） |
| 麦克风按钮 | 缩小并保留在工具栏右侧（18×18） |
| 权限警告条 | 仅在 `bypassPermissions` / `dontAsk` 时显示 |
| 顶栏三按钮 | 先做 UI 占位，onClick 空 |
| 侧栏 section-title | 按原型调到 12px / 500 / 大写字距 |

---

## 三、实施计划

### Phase 1 · Markdown 渲染（核心）

**新增** `apps/desktop/src/renderer/components/MarkdownMessage.tsx`
- `marked` 解析 → `xss` 白名单清洗 → `dangerouslySetInnerHTML`
- `highlight.js` 做代码块高亮，自动检测语言
- 自定义 renderer：行内 `code` 渲染为浅底圆角 pill
- 代码块外层加语言标签 + 复制按钮
- streaming 兜底：检测未闭合 ```` ``` ````，自动补尾再渲染
- 链接强制 `target="_blank" rel="noreferrer noopener"`

**新增** `apps/desktop/src/renderer/styles/markdown.css`
- 标题层级、列表缩进、表格边框、blockquote 左竖线、inline code pill、代码块面板、链接色

**改** `apps/desktop/src/renderer/components/QuickChatView.tsx`
- 删除 `renderSafeMarkdown`（第 172-197 行）
- `assistant-message-body` 内改用 `<MarkdownMessage text={message.text} streaming={message.streaming} />`

**改** `apps/desktop/src/renderer/styles.css`（或聚合入口）
- `import './styles/markdown.css'`

### Phase 2 · 对话顶栏右侧三按钮（UI 占位）

**改** `QuickChatView.tsx` + `styles/main.css`
- `chat-session-header` 右侧加 `.chat-session-actions`
- 三按钮：`Code2` / `Columns2` / `Maximize2`
- `onClick={() => {}}`，title 用中文 tooltip

### Phase 3 · 处理状态提示

**改** `QuickChatView.tsx` + `styles/main.css`
- 替换 `正在思考` 为 `<button class="chat-thinking-pill">✦ 已处理 {n}s ›</button>`
- 用 `useState + useEffect/setInterval` 累加秒数
- `@keyframes spin` 给旋转图标

**改** `DesktopSidebar.tsx` + `styles/sidebar.css`
- `task-time` 为 `running` 时换成 `<Loader2 className="spin">`

### Phase 4 · 发送按钮

**改** `ComposerCard.tsx`
- `Send` → `ArrowUp`，size 18

### Phase 5 · 模型 chip 文案精简

**改** `apps/desktop/src/renderer/modelPresets.ts`
- `ModelPreset` 增加 `shortLabel?: string`
- 内置预设给短名（如 `claude-3.5-sonnet` → `3.5 sonnet`）

**改** `ComposerCard.tsx`
- trigger 文案优先 `shortLabel ?? label`

### Phase 6 · 完全访问权限警告条

**改** `ComposerCard.tsx` + `styles/composer.css`
- 当 `permissionMode ∈ {bypassPermissions, dontAsk}` 时，`.composer-bottom` 上方插入 `.permission-warning-banner`
- 浅色：橙字 + 浅橙底；深色：金字 + 半透明暗底
- 文案：`完全访问权限 · 此对话允许直接读写文件和运行命令`

### Phase 7 · 麦克风按钮缩小

**改** `styles/composer.css`
- `.composer-mic-button` 由 24×24 → 18×18，颜色 `--c-icon-soft`

### Phase 8 · 深色主题用户气泡色

**改** `styles/base.css`
- 新增 `--c-user-bubble-bg`，与 `--c-bg-chip-hover` 解耦
- 浅色：`#f1f1f1`；深色：`#3a3d4f`（中性深灰）

**改** `styles/main.css`
- `.user-message-bubble` 改用 `--c-user-bubble-bg`

### Phase 9 · 侧栏 section-title 字体

**改** `styles/sidebar.css`
- `.section-title`：12px / 500 / `text-transform: uppercase` / `letter-spacing: 0.04em` / color `--c-text-meta`

---

## 四、文件清单

### 新增（2 个）
- `apps/desktop/src/renderer/components/MarkdownMessage.tsx`
- `apps/desktop/src/renderer/styles/markdown.css`

### 修改（9 个）
- `apps/desktop/src/renderer/components/QuickChatView.tsx`
- `apps/desktop/src/renderer/components/ComposerCard.tsx`
- `apps/desktop/src/renderer/components/DesktopSidebar.tsx`
- `apps/desktop/src/renderer/modelPresets.ts`
- `apps/desktop/src/renderer/styles/main.css`
- `apps/desktop/src/renderer/styles/composer.css`
- `apps/desktop/src/renderer/styles/sidebar.css`
- `apps/desktop/src/renderer/styles/base.css`
- `apps/desktop/src/renderer/styles.css`（聚合入口，引入 markdown.css）

---

## 五、验证步骤

1. `bun run typecheck`（仓库已有命令，验证类型）
2. `bun run desktop:build`（验证构建通过）
3. 浅色和深色主题各跑一遍，肉眼对比原型图

## 六、不在本轮范围

- VS Code / 分屏 / 展开 真实业务（仅占位）
- 处理步骤展开卡片（只显示秒数 pill）
- 顶栏菜单交互行为变更
