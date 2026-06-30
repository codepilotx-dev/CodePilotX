# ClaudeCode Memory 模块概览

> 探索日期:2026-06-28

## 概述

ClaudeCode 的 **memory 模块**是一个**基于文件的持久化记忆系统**,通过本地 Markdown 文件(`MEMORY.md` + 主题文件 + frontmatter)让 LLM 在跨会话中保留用户偏好、项目背景、外部系统引用等信息。

整体架构分三层:

| 层级 | 路径 | 作用 |
|------|------|------|
| 核心状态 | `packages/core/src/memory/state.ts` | 纯函数:路径解析、状态判定、安全校验 |
| 应用层 | `apps/tui/src/memdir/` | 提示词组装、文件扫描、检索读取、写入工具 |
| UI/命令 | `apps/tui/src/{components,commands,utils}/memory/` | `/memory` 命令、文件选择器、通知组件 |

---

## 1. 记忆类型(`memoryTypes.ts`)

四类**封闭分类**,通过 frontmatter 的 `type` 字段区分:

| 类型 | scope | 用途 |
|------|-------|------|
| `user` | always private | 用户角色、目标、知识背景 |
| `feedback` | 默认 private | 用户对协作方式的纠正或确认 |
| `project` | 默认 team | 项目背景、决策、deadline、stakeholder |
| `reference` | 通常 team | 外部系统指针(Linear / Slack / Grafana 等) |

每类都有独立的 `<when_to_save>` / `<how_to_use>` / `<body_structure>` 描述。

**明确不保存的内容**(WHAT_NOT_TO_SAVE_SECTION):
- 代码模式、架构、文件路径 — 可从代码派生
- git 历史 — `git log` / `git blame` 是权威源
- 调试解决方案 — 修复已在代码里
- CLAUDE.md 已记录的内容
- 临时任务细节

`memoryTypes.ts` 同时维护两套提示词:
- `TYPES_SECTION_COMBINED` — 私+团双目录模式(含 `<scope>` 标签)
- `TYPES_SECTION_INDIVIDUAL` — 单目录模式(精简示例)

---

## 2. 路径解析与启用门控

### 2.1 路径解析优先级(`paths.ts:180-201`)

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env(完整路径覆盖,用于 Cowork)
2. `autoMemoryDirectory` settings.json(仅 trusted 来源,policy/local/user,**排除 projectSettings** 防供应链攻击)
3. 默认:`<memoryBase>/projects/<sanitized-git-root>/memory/`

`memoryBase` 解析:`CLAUDE_CODE_REMOTE_MEMORY_DIR` → `~/.claude`

### 2.2 启用条件链(`paths.ts:35-50`)

按顺序短路,**任一条件命中即关闭**:

1. `CLAUDE_CODE_DISABLE_AUTO_MEMORY` env 为真
2. `CLAUDE_CODE_SIMPLE` / `CODEPILOTX_SIMPLE` 为真
3. 远程模式 + 未设置 `CLAUDE_CODE_REMOTE_MEMORY_DIR`
4. `settings.json` 的 `autoMemoryEnabled === false`
5. 默认启用

### 2.3 安全校验(`state.ts:144-171`)

`validateAutoMemoryDirectory()` 拒绝:
- 相对路径(`!isAbsolute`)
- 长度 < 3(根目录 / `C:`)
- UNC 路径(`\\server\share`)
- 含 null 字节
- 不允许 `~/` 在 env override 中展开(防攻击面扩大)

输出路径总是 NFC 规范化 + 一个尾部分隔符。

### 2.4 特殊路径变体

- **团队记忆**:`<autoDir>/team/`(`teamMemPaths.ts:84`)
- **每日日志**(KAIROS 长会话模式):`logs/YYYY/MM/YYYY-MM-DD.md`
- **入口文件**:`MEMORY.md`(200 行 / 25KB 上限,`memdir.ts:35-38`)
- **sanitizePath**:非 `[a-zA-Z0-9]` → `-`,超过 100 字符截断并附 36 进制 hash 防碰撞

---

## 3. 提示词组装(`memdir.ts`)

### 3.1 三模式分发(`loadMemoryPrompt`,`memdir.ts:419-507`)

```
KAIROS + autoEnabled + kairosActive
  └─ buildAssistantDailyLogPrompt (追加到每日日志)
TEAMMEM + isTeamMemoryEnabled()
  └─ buildCombinedMemoryPrompt (私+团双目录)
autoEnabled (默认)
  └─ buildMemoryLines (单目录)
未启用
  └─ null + 上报 tengu_memdir_disabled
```

**关键决策**:`MEMORY.md` **始终**加载到 system prompt 中(用于每次对话的"方向感"),但写入走两段式:写主题文件 + 改 MEMORY.md 索引条目。

### 3.2 MEMORY.md 截断(`truncateEntrypointContent`)

行截断优先 → 字节截断兜底,总是追加说明哪条限制触发,提示模型把详情下沉到主题文件。

### 3.3 KAIROS 模式

长会话场景使用 append-only 日志避免 MEMORY.md 频繁重写,夜间 `/dream` 把日志蒸馏成主题文件 + 更新 MEMORY.md。提示词用 `YYYY-MM-DD` 模式而非内联当日字面量,保持 system prompt 缓存前缀跨午夜稳定。

---

## 4. 检索流程

### 4.1 扫描(`memoryScan.ts:35-77`)

`scanMemoryFiles()`:
- `readdir({ recursive: true })`
- 过滤 `.md` 但排除 `MEMORY.md`
- 单次 `readFileInRange(0, 30 lines)` 读 frontmatter,**避免双 stat**
- `Promise.allSettled` 容错,只保留 fulfilled
- 按 mtime 倒序,最多 200 个

### 4.2 选片(`findRelevantMemories.ts:39-75`)

```
扫描 frontmatter → sideQuery (Sonnet) 选最多 5 个
  ↓
  SELECT_MEMORIES_SYSTEM_PROMPT 提示词:
    - 只选"明确有用"的,模糊的不选
    - 排除正在使用的工具的 reference 文档
      (但保留 warnings / gotchas)
    - 最近已展示过的文件通过 alreadySurfaced 过滤
```

返回 `{path, mtimeMs}` 让上层不用再 stat。

---

## 5. 团队记忆安全模型(`teamMemPaths.ts`)

团队记忆写入是**安全敏感路径**,实现两层防护:

### 5.1 字符串层(`sanitizePathKey` + `resolve`)
- 拒绝 null 字节(系统调用截断)
- 解码 URL 后若产生 `..` 或 `/` 拒绝
- NFKC 归一化后产生危险模式拒绝(全角 `．．／`)
- 拒绝反斜杠、绝对路径

### 5.2 符号链接层(`realpathDeepestExisting` + `isRealPathWithinTeamDir`)
- 对**最深存在的祖先**做 `realpath()`(PSR M22186 防御)
- `lstat` 区分"真不存在" vs "悬挂符号链接"(后者是攻击向量)
- 检测 ELOOP(符号循环)、EACCES / EIO(失败关闭)
- 团队目录不存在时跳过符号链接检查(无目录则无逃逸可能)

---

## 6. UI 与命令

### 6.1 `/memory` 斜杠命令

入口 `apps/tui/src/commands/memory/index.ts` 注册 `local-jsx` 命令,实际渲染 `MemoryCommand` 组件:

`memory.tsx`:
- `Dialog` 包裹,`MemoryFileSelector` 主体
- 选中后用 `$EDITOR` / `$VISUAL` 编辑(`editFileInEditor`)
- 文件不存在则用 `flag: 'wx'` 创建空文件,保留已有内容

### 6.2 文件选择器(`MemoryFileSelector.tsx`)

对话框列出:
- **Auto-memory / Auto-dream 开关切换**(顶部 Toggle,focusable)
- **User memory**(`~/.claude/CLAUDE.md`)
- **Project memory**(`./CLAUDE.md`,git 仓库中显示 "checked in")
- **@-imported 文件**(已存在记忆树)
- **打开 auto-memory / 团队 / agent 记忆文件夹**(支持 Open folder)

`useKeybinding` 集成 `confirm:no/yes` + `select:next/previous`,可上下导航切换 toggle 焦点与列表焦点。

### 6.3 写入通知(`MemoryUpdateNotification.tsx`)

顶部一行 `Memory updated in <relative-path> · /memory to edit`,路径自动取 `~` 或 `./` 相对表示。

---

## 7. 文件清单

```
packages/core/src/memory/
  state.ts                    # 路径解析 + 类型定义
  state.test.ts               # 单元测试

apps/tui/src/memdir/
  paths.ts                    # env-aware 路径解析
  memdir.ts                   # 提示词构建 + MEMORY.md 截断
  memoryTypes.ts              # 四类记忆的提示词片段
  memoryScan.ts               # 扫描 frontmatter
  findRelevantMemories.ts     # sideQuery 检索
  memoryAge.ts                # 记忆陈旧度
  memoryShapeTelemetry.ts     # 形状遥测
  teamMemPaths.ts             # 团队记忆路径 + 安全
  teamMemPrompts.ts           # 团队记忆提示词

apps/tui/src/components/memory/
  MemoryFileSelector.tsx      # /memory 对话框列表
  MemoryUpdateNotification.tsx# 写入后顶部提示

apps/tui/src/commands/memory/
  memory.tsx                  # 命令实现
  index.ts                    # 命令注册

apps/tui/src/utils/memory/
  types.ts                    # MemoryType 枚举(User/Project/AutoMem/TeamMem)
  versions.ts                 # git 仓库检测辅助
```

---

## 8. 关键设计取舍

| 取舍 | 理由 |
|------|------|
| MEMORY.md 总是进 system prompt | 方向感,但强制 200 行 / 25KB 上限 |
| 类型是封闭的四类 | 防止模型把"活动日志"当记忆保存 |
| projectSettings 不允许改 memory 路径 | 防供应链攻击(`~/.ssh` 静默写访问) |
| KAIROS 用 append-only 日志 | 避免频繁改 MEMORY.md,夜间统一蒸馏 |
| sideQuery 选片而非全量加载 | 200 文件不爆 context window,选 5 个 |
| 真实路径 + 字符串双重校验 | `path.resolve` 不解析 symlink |
| MEMORY.md 入口是索引而非内容 | 主题文件存细节,索引只放一行 hook |
| `getAutoMemPath` 用 lodash memoize | render-path 高频调用,key 用 projectRoot |