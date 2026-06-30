# `apps/tui/src/constants/prompts.ts` 提示词分析

> 范围：`D:\VueProject\CodePilotX\apps\tui\src\constants\prompts.ts`（914 行）
>
> 角色：CLI / TUI 端**系统提示词（System Prompt）** 的总组装入口。它不是单个提示词，而是把所有静态 / 动态段落拼成 `string[]`，按顺序送给模型。

---

## 1. 文件全景

| 维度 | 说明 |
| --- | --- |
| **文件类型** | TypeScript 源文件（`.ts`），不是 `.tsx` |
| **核心导出** | `getSystemPrompt`、`enhanceSystemPromptWithEnvDetails`、`computeEnvInfo`、`computeSimpleEnvInfo`、`DEFAULT_AGENT_PROMPT`、`getUnameSR`、`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`、`CLAUDE_CODE_DOCS_MAP_URL`、`prependBullets` |
| **核心作用** | 拼装系统提示词，并在 `static ⇄ dynamic` 边界上做 **Prompt Cache** 切片 |
| **段落数** | 静态段 6 段 + 动态段最多 13 段（按 session / feature / 用户类型 开关） |
| **模型身份** | 内部最新前沿模型 = `Claude Opus 4.6`（`@ant` 私有，外部构建会通过 DCE 消除引用） |

---

## 2. 顶层结构

```text
prompts.ts
├── 导入（tools / utils / feature flags / DCE'd 模块）
├── 常量
│   ├── CLAUDE_CODE_DOCS_MAP_URL
│   ├── SYSTEM_PROMPT_DYNAMIC_BOUNDARY  ← 缓存切片边界标记
│   ├── FRONTIER_MODEL_NAME
│   ├── CLAUDE_4_5_OR_4_6_MODEL_IDS
│   └── SUMMARIZE_TOOL_RESULTS_SECTION
├── 段落构造器
│   ├── getHooksSection / getSystemRemindersSection
│   ├── getAntModelOverrideSection
│   ├── getLanguageSection
│   ├── getOutputStyleSection
│   ├── getMcpInstructionsSection (+ getMcpInstructions)
│   ├── getSimpleIntroSection
│   ├── getSimpleSystemSection
│   ├── getSimpleDoingTasksSection
│   ├── getActionsSection
│   ├── getUsingYourToolsSection
│   ├── getAgentToolSection
│   ├── getDiscoverSkillsGuidance
│   ├── getSessionSpecificGuidanceSection
│   ├── getOutputEfficiencySection
│   ├── getSimpleToneAndStyleSection
│   ├── getScratchpadInstructions
│   ├── getFunctionResultClearingSection
│   ├── getBriefSection
│   └── getProactiveSection
├── 顶层入口
│   ├── getSystemPrompt(tools, model, dirs?, mcpClients?)
│   ├── enhanceSystemPromptWithEnvDetails
│   ├── computeEnvInfo / computeSimpleEnvInfo
│   ├── getKnowledgeCutoff
│   ├── getShellInfoLine / getUnameSR
│   └── DEFAULT_AGENT_PROMPT
```

---

## 3. 关键设计机制

### 3.1 Prompt Cache 切片：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`

```ts
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
```

- `getSystemPrompt` 末尾会插入这个**字符串标记**（仅当 `shouldUseGlobalCacheScope()` 为真时）。
- 它把提示词切成两半：
  - **标记之前** = 静态（`scope: 'global'`，跨 org 可命中缓存）
  - **标记之后** = 动态（每次/每个 session 重新算）
- **警告**：源码里明确写了不要挪动该标记，相关逻辑在：
  - `src/utils/api.ts` 的 `splitSysPromptPrefix`
  - `src/services/api/claude.ts` 的 `buildSystemPromptBlocks`
- 这是一个**性能优化**点，跨 org 命中缓存能省下大量重复 token。

### 3.2 `process.env.USER_TYPE === 'ant'` 内部分支

几乎每个段落都做了这种判断：

```ts
...(process.env.USER_TYPE === 'ant'
  ? [/* 更严厉 / 更详细的指导 */]
  : []),
```

含义：
- `ant` = Anthropic 内部员工（"ant team"）构建版本
- 外部构建会通过 `bun:bundle` 的 `--define` 把它常量折叠成 `false`，整段被 DCE 掉
- 内部版会附加强约束（见 §6），例如：
  - 不允许冗余注释（注释必须解释 WHY，而不是 WHAT）
  - 任务完成前**必须**自行验证（运行测试 / 脚本 / 检查输出）
  - 误报防御（不得把失败的测试说成通过）
  - `CodePilotX` 自身 bug 走 `/issue`、`/share` 上报
  - 强语气（assertiveness）纠正项（Capybara v8 校准）

> AGENTS.md 也明确要求："Do not edit generated files by hand" + "Use typed helpers already present" —— 这两段 ant-only 指令正是 `Capybara v8 thoroughness / assertiveness counterweight`（PR #24302）的实验，A/B 通过后会**取消** gating。

### 3.3 `bun:bundle` 的 `feature('FOO')` 编译期开关

```ts
import { feature } from 'bun:bundle'
const BRIEF_PROACTIVE_SECTION: string | null =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? require('../tools/BriefTool/prompt.js').BRIEF_PROACTIVE_SECTION
    : null
```

这是 Bun 打包器在编译期把 `feature('FOO')` 替换成 `true` / `false` 的常量，从而把整条 `require` 链 DCE 掉。看到下面这些 `feature(...)`，就知道它们是**特性开关**：

| Feature Flag | 作用 | 引用位置 |
| --- | --- | --- |
| `CACHED_MICROCOMPACT` | 缓存式微压缩，模型上下文自动清理旧 tool 结果 | `getFunctionResultClearingSection` |
| `PROACTIVE` / `KAIROS` | 自主 Agent 模式（autonomous loop + 周期性 tick） | `getProactiveSection`, `getSystemPrompt` |
| `KAIROS_BRIEF` | 简短汇报模式（Brief） | `getBriefSection`, `BRIEF_PROACTIVE_SECTION` |
| `EXPERIMENTAL_SKILL_SEARCH` | 暴露 `DiscoverSkills` 工具 | `getDiscoverSkillsGuidance` |
| `VERIFICATION_AGENT` | 强制反方验证（ant + GrowthBook flag 双重门） | `getSessionSpecificGuidanceSection` |
| `TOKEN_BUDGET` | 提示模型"达到 token 目标"才会被自动续命 | `dynamicSections` |

> 注意 `getDiscoverSkillsGuidance` 的注释：
> Capture the module (not `.isSkillSearchEnabled` directly) so `spyOn()` in tests patches what we actually call — a captured function ref would point past the spy.
> 这是测试时**避免被 spy 绕过**的细节。

### 3.4 `isUndercover()` 防泄露

```ts
if (process.env.USER_TYPE === 'ant' && isUndercover()) {
  // suppress model name/ID entirely
}
```

作用：在某些构建（如预发布、公开 PR）里**完全抹去**所有模型名 / 模型 ID / CodePilotX 产品名，避免内部代号 / 未发布模型名泄露到公开 commit / 截图里。

---

## 4. 静态段（缓存命中区）

`getSystemPrompt()` 在 boundary 之前输出 6 段（外加 boundary 本身）。逐段拆解：

### 4.1 `# Intro`（`getSimpleIntroSection`）

```text
You are an interactive agent that helps users
  - [if output style] "according to your 'Output Style' below..."
  - [else]          "with software engineering tasks."
Use the instructions below and the tools available to you to assist the user.

[cyberRiskInstruction]   ← 注入安全风险红线（来自 ./cyberRiskInstruction.ts）
IMPORTANT: You must NEVER generate or guess URLs for the user unless
you are confident that the URLs are for helping the user with programming.
You may use URLs provided by the user in their messages or local files.
```

要点：
- **身份被输出样式影响**：如果设了 output style，开场白会改成 "according to your 'Output Style'"。
- **URL 限制**：禁止编 URL（"never generate or guess URLs"），只能复用用户给的或本地的。
- **`CYBER_RISK_INSTRUCTION`** 是另一文件注入的硬性安全指令。

### 4.2 `# System`（`getSimpleSystemSection`）

6 条要点：

1. 文字 = 给用户看的（**CommonMark + 等宽字体**）。
2. 工具在用户选的 **permission mode** 下跑；被拒绝时不要重试同一调用，要反思。
3. `<system-reminder>` 是系统自动注入的，与具体 tool 结果无强语义关联。
4. **Prompt Injection 提示**：怀疑 tool 结果包含注入时立刻向用户报警。
5. Hooks：用户可以在 `settings` 里配 hook；`<user-prompt-submit-hook>` 等反馈等同用户；被 hook 阻断时要么调整行为要么让用户查配置。
6. **自动压缩**：对话不会被 context window 卡死，模型侧会做 summarization。

### 4.3 `# Doing tasks`（`getSimpleDoingTasksSection`）

**核心任务执行哲学**：

- 任务定位：软件工程任务，模糊指令要按"在 CWD 里"来理解（例如 `methodName` → 改代码，不是只回字符串）。
- **能力边界**：能 defer to user judgement about scope。
- 主动指出错误（ant only）："You're a collaborator, not just an executor"。
- **先读后改**："In general, do not propose changes to code you haven't read."
- **不创造新文件**：默认编辑而非新建。
- **不给时间预估**："Avoid giving time estimates or predictions"。
- 失败要先诊断再换打法；用 `AskUserQuestion` **只在真的卡住后**，不要第一反应就抛问题。
- **OWASP Top 10 安全**：写完自检，自己写出漏洞立刻修。
- 反向兼容 hack（`_var`、`// removed`）一律不要，确定没用就删。
- 误报防御（ant only）：不许把失败测试说成通过，不许把工作说成"完成"。
- `/help`、反馈渠道：`MACRO.ISSUES_EXPLAINER` 是宏注入的"如何提 issue"说明（构建期替换）。
- `CodePilotX` 自身 bug 推荐 `/issue`（模型问题）或 `/share`（产品 bug，附 ccshare 链接 + Slack MCP 时主动建议发到 `#claude-code-feedback`，频道 ID `C07VBSHV7EV`）。

#### 注释规范（ant only）

```text
- Default to writing no comments.
- Only add one when the WHY is non-obvious.
- Don't explain WHAT the code does.
- Don't reference the current task, fix, or callers in comments.
- Don't remove existing comments unless you're removing the code they describe.
- Before reporting a task complete, verify it actually works.
- If you can't verify, say so explicitly.
```

这是 **Capybara v8 thoroughness counterweight**（PR #24302），专门对抗"模型默认过度注释"和"汇报但不验证"。

### 4.4 `# Executing actions with care`（`getActionsSection`）

风险分级执行：

- **可逆 / 本地**：直接做（编辑文件、跑测试）。
- **不可逆 / 影响外部共享系统 / 高破坏面**：先**确认**再做。
- 一次性授权不构成"任何上下文都授权"（"A user approving an action (like a git push) once does NOT mean that they approve it in all contexts"）。
- 显式列出要确认的场景：
  - 删除（`rm -rf`、drop table、删 branch）
  - 难回滚（force-push、`reset --hard`、amend published commit、升降级依赖、动 CI/CD）
  - 共享状态可见（push、PR/issue、Slack/email、共享基础设施）
  - 上传到第三方（可能缓存/索引，即使后删也在）
- 遇阻时**不要用破坏性捷径**（如 `--no-verify` 跳过 hook），要查根因。
- 陌生文件 / 分支 / 配置：先调查后清理（merge conflict 要解不是 discard，lock file 要看哪个进程持有）。
- **量两次裁一次**（"measure twice, cut once"）。

### 4.5 `# Using your tools`（`getUsingYourToolsSection`）

REPL 模式、非 REPL 模式有分支。

非 REPL 模式：
- 优先用专用工具而非 Bash：
  - `Read` 替 `cat/head/tail/sed`
  - `Edit` 替 `sed/awk`
  - `Write` 替 `cat <<EOF` / `echo >`
  - `Glob` 替 `find/ls`（嵌入式 bfs 模式下不显示这条）
  - `Grep` 替 `grep/rg`（嵌入式 ugrep 模式下不显示这条）
- Bash 只在**确实需要 shell** 时用。
- 任务管理工具：`TaskCreate` / `TodoWrite`（**谁先开谁就出现**），任务做完**立刻**标完成，不要攒批。
- **并行工具调用**：无依赖的工具放一个回合里并行；存在依赖（如某步结果决定下一步）则串行。

> 嵌入式搜索工具（`hasEmbeddedSearchTools()`）注释：
> Ant-native builds alias `find`/`grep` to embedded `bfs`/`ugrep` and remove the dedicated Glob/Grep tools, so skip guidance pointing at them.
> 内部构建的 Bash 直接被替换成 bfs / ugrep，Glob/Grep 工具被去掉了，所以这一段引导在内部构建里要跳过。

### 4.6 `# Tone and style`（`getSimpleToneAndStyleSection`）

- 不用 emoji（除非用户显式要求）。
- 外部构建：要求"短而简"。
- 代码引用必须用 `file_path:line_number` 格式（让用户能跳转）。
- GitHub 引用用 `owner/repo#123` 格式（自动渲染成可点链接）。
- **工具调用前不要冒号**："Let me read the file:" → "Let me read the file."（冒号后接工具调用会让显示错位）。

### 4.7 `# Output efficiency` / `# Communicating with the user`（`getOutputEfficiencySection`）

**两套文案**（ant vs 外部）：

**外部构建（默认）**：
- 简明扼要，lead with the answer。
- 跳过 filler / preamble / 过渡词。
- 不复述用户的话。
- 只汇报：要用户决策的事 / 关键里程碑 / 错误或阻塞。
- "If you can say it in one sentence, don't use three."

**内部构建（ant）**：
- "You're writing for a person, not logging to a console."
- 用户**看不到**多数 tool calls，只能看到文字。
- 工具调用前要先说一句要做什么。
- 工作中要在关键节点简短更新（"found something load-bearing"、"changing direction"、"made progress"）。
- 假设用户已经走神了，**写完整句子、不用简称、扩展术语**。
- 用流畅 prose，**避免过度 em-dash、符号、片段**。
- 表格只用于：短枚举事实 / 定量数据；不要在表格单元格里塞解释性推理。
- 避免 semantic backtracking：句子线性递进，不要让读者回头重新解析。
- **理解优先于简洁**："the goal is the reader understanding, not terseness."
- 匹配任务复杂度：简单问题直接 prose 答，不要 headers + numbered list。
- 倒金字塔：先动作再解释。
- 这些规则**不适用于**代码 / 工具调用。

> 整段以 `// @[MODEL LAUNCH]: Remove this section when we launch numbat.` 注释提示：等 numbat 模型发布后可以删除该差异。

---

## 5. 动态段（boundary 之后，按 session 切换）

```ts
const dynamicSections = [
  session_guidance,            // 工具特化的 session 指引
  memory,                      // CLAUDE.md / user 记忆
  ant_model_override,          // 内部模型后缀
  env_info_simple,             // 环境信息
  language,                    // 用户语言偏好
  output_style,                // 输出样式 prompt
  mcp_instructions,            // MCP 服务器说明（uncached，MCP 会在 turn 间连接/断开）
  scratchpad,                  // 临时工作区
  frc,                         // Function Result Clearing（缓存式微压缩）
  summarize_tool_results,      // "tool 结果可能稍后被清，写下你后面要用的关键信息"
  numeric_length_anchors,      // ant only：≤25 词/段间，≤100 词/最终回
  token_budget,                // "用户给 token 目标就一直工作"
  brief,                       // KAIROS 简报模式
]
```

### 5.1 `getSessionSpecificGuidanceSection`（最复杂的一段）

按工具开关输出针对性指引：

- **有 `AskUserQuestion` 工具**：被拒的工具调用若不理解，**用 `AskUserQuestion`** 询问。
- **非交互 session**（`getIsNonInteractiveSession()`）：跳过"让用户自己跑 `gcloud auth login`"这条。
- **有 `Agent` 工具**（subagent）：
  - `isForkSubagentEnabled()`：走 fork 模式说明（"Calling `Agent` without a subagent_type creates a fork... runs in the background and keeps its tool output out of your context"）。**如果是 fork 自己**（被生成出来的），要直接执行、不要再次委派。
  - 否则走 subagent 模式说明（"Subagents are valuable for parallelizing independent queries"）。
  - `areExplorePlanAgentsEnabled() && !isForkSubagentEnabled()`：补充 explore 模式分流：简单定向搜索用 `Glob` / `Grep`（或嵌入式 `find`/`grep`），更广的探索用 `Agent` + `subagent_type=EXPLORE_AGENT`，且**慢于直接搜索**，只在**简单搜索不够**或**预期要超过 `EXPLORE_AGENT_MIN_QUERIES` 个查询**时才用。
- **有 Skill 工具**：`/<skill-name>` 是用户调用 user-invocable skills 的简写，模型要用 `Skill` 工具**只**针对其列表中的 skill 执行，**不要自己猜**或用内置 CLI 命令替代。
- **DiscoverSkills 工具 + Skill 工具 + 实验开关**：注入 DiscoverSkills 提示（"Skills relevant to your task: 已在每轮自动浮出；如要做浮出列表外的事再调用 DiscoverSkills"）。
- **Verification Agent（ant only + GrowthBook flag `tengu_hive_evidence`）**：

  > 这段是 "contract" 风格的强约束。
  > 
  > 触发条件：本轮发生 **3+ 文件修改 / 后端 / API / 基础设施**级别的非平凡实现。
  > 行为：必须 spawn `Agent` with `subagent_type=VERIFICATION_AGENT_TYPE`，把原始用户请求、所有改动文件、方案、plan 文件路径传过去。
  > 模型自己 / fork 自己的 self-check **不算**验证。只有 verifier 能给 verdict，**不能自赋 PARTIAL**。
  > 失败：修，用 verifier 的 findings 续调，直到 PASS。
  > 通过：spot-check 2-3 个 PASS 块重跑，确认每条 PASS 都有 Command run block 且输出对得上。
  > PARTIAL（verifier 给的）：报告通过项 + 未验证项。

  注意注释 `3P default: false — verification agent is ant-only A/B`：第三方产品默认关闭，是 ant 内部的 A/B。

### 5.2 `getMcpInstructions` / `getMcpInstructionsSection`

把每个**已连接**且**有 `instructions` 字段**的 MCP server 拼成：

```text
# MCP Server Instructions
The following MCP servers have provided instructions...

## {name}
{instructions}
```

`DANGEROUS_uncachedSystemPromptSection` 包裹：标记为"uncached"，因为 MCP server 可能**在 turn 之间连接/断开**。当 `isMcpInstructionsDeltaEnabled()` 打开时，instructions 改由 `attachments.ts` 的 `mcp_instructions_delta` 持久化附件投递，**避免每 turn 重算击穿 prompt cache**。

### 5.3 `getScratchpadInstructions`

只有 `isScratchpadEnabled()` 才出现。要点：

- 用**会话级**的 scratchpad 目录替 `/tmp`。
- 包括：中间结果、临时脚本、不属于项目的输出、分析文件。
- **只有用户显式要求时**才用 `/tmp`。
- 该目录是**会话隔离**的，可以自由写，不弹权限框。

### 5.4 `getFunctionResultClearingSection`（FRC）

`CACHED_MICROCOMPACT` feature + `getCachedMCConfigForFRC()` + 模型白名单 + `systemPromptSuggestSummaries` 开关都满足时才输出：

```text
Old tool results will be automatically cleared from context to free up space.
The {N} most recent results are always kept.
```

`SUMMARIZE_TOOL_RESULTS_SECTION` 始终注入：

```text
When working with tool results, write down any important information you
might need later in your response, as the original tool result may be
cleared later.
```

### 5.5 `numeric_length_anchors`（ant only）

```text
Length limits: keep text between tool calls to ≤25 words.
Keep final responses to ≤100 words unless the task requires more detail.
```

> 注释：~1.2% output token 下降（vs 定性 "be concise"），ant 限用来**先看质量影响**再放外部。

### 5.6 `token_budget`（feature gated）

```text
When the user specifies a token target (e.g., "+500k", "spend 2M tokens",
"use 1B tokens"), your output token count will be shown each turn.
Keep working until you approach the target — plan your work to fill it
productively. The target is a hard minimum, not a suggestion. If you
stop early, the system will automatically continue you.
```

> 注释说明：曾用 `DANGEROUS_uncached` 跟随 `getCurrentTurnTokenBudget()` 切换，导致 ~20K token / 切换被击穿缓存。现改为**无条件缓存**（无 budget 时整段是 no-op）。改回 tail attachment 失败过（`#21577`），所以保留当前位置。

### 5.7 `getBriefSection`（KAIROS / KAIROS_BRIEF）

简短汇报模式，提示模型的简要输出风格。`briefToolModule?.isBriefEnabled()` 关闭时不出现。注释说明 `/brief` toggle 和 `--brief` flag 现在**只控制显示过滤**，不再门控模型行为。

### 5.8 `getProactiveSection`（KAIROS / PROACTIVE）

这是 `// Autonomous work` 整段，最长。

要点：
- 注入 `<{TICK_TAG}>` 心跳（注释里说是 `TICK_TAG`，来自 `./xml.ts`）。
- 时间戳是用户本地时间；外部工具（Slack、GitHub）可能是别的时区。
- 多个 tick 会被 batch 进同一条消息，**不要 echo / repeat tick 内容**。
- **Pacing**：用 `Sleep` 工具控制间隔，**5 分钟无活动 prompt cache 过期**，要平衡 sleep 时长。
- **没活干就 Sleep**："If you have nothing useful to do on a tick, you MUST call Sleep. Never respond with only a status message."
- **First wake-up**：新会话的第一次 tick 简短问候 + 问做什么，**不要主动探索代码**。
- **Subsequent wake-ups**：自问"我还不知道什么？可能哪里出错？做完前要验证什么？"——主动 reduce risk / build understanding。**不要 spam 用户**。
- **Staying responsive**：用户活跃时反馈循环要紧。
- **Bias toward action**：自己判断，不要事事确认（读、搜、改、commit 都可自主）；拿不准就**选一个**走，可随时调整。
- **Be concise**：高层里程碑汇报，不流水账。
- **Terminal focus**：根据 `terminalFocus` 调自主度——
  - Unfocused：用户不在，**重度自主**（推 commit / push），只对不可逆 / 高风险暂停。
  - Focused：用户在看，**协作模式**（提选项、大改动前问、保持简短）。

---

## 6. 其它顶层函数

### 6.1 `getSystemPrompt(tools, model, additionalWorkingDirectories?, mcpClients?)`

主入口，组装顺序：

```text
1. CLAUDE_CODE_SIMPLE 环境变量开启 → 返回极简 ["You are CodePilotX, ..."]  （用 getCwd + session start date）
2. 并行加载 skillToolCommands / outputStyleConfig / envInfo
3. feature('PROACTIVE') || feature('KAIROS') 且 isProactiveActive → 走 proactive 简版系统提示
4. 否则：构造 dynamicSections（按特性/用户类型门控），resolve，吐出 6 段静态 + boundary + 动态段
```

> `// === BOUNDARY MARKER - DO NOT MOVE OR REMOVE ===` 注释强调：marker 物理位置变了会破坏缓存逻辑。

### 6.2 `computeEnvInfo` / `computeSimpleEnvInfo`

- `computeEnvInfo` 是给 subagent 用的（被 `enhanceSystemPromptWithEnvDetails` 调用）。
- `computeSimpleEnvInfo` 是给主会话 dynamic section 用的。
- 两者都**内联** `process.env.USER_TYPE === 'ant'`（注释要求"不要提升为 const"，否则 DCE 不掉）。
- 输出：
  - `<env>` 块：cwd、git repo、附加目录、platform、shell、OS Version。
  - `modelDescription`："You are powered by the model named {marketing}. The exact model ID is {modelId}."（undercover 抑制）
  - `knowledgeCutoffMessage`：根据模型 ID 查 `getKnowledgeCutoff`。
  - 主会话还附加：当前模型族（Claude 4.5/4.6）、`CodePilotX` 形态（CLI / desktop / web / IDE）、Fast mode（同模型，仅更快，可 `/fast` 切换）—— 这三条都是 **ant only** 在外部构建里被 undercover / DCE 抹去。

### 6.3 `getKnowledgeCutoff(modelId)`

`@ant` 内部在新增模型时要在这里追加（`@[MODEL LAUNCH]: Add a knowledge cutoff date for the new model.`）。当前映射：

| 模型（canonical 包含） | 截止 |
| --- | --- |
| `claude-sonnet-4-6` | August 2025 |
| `claude-opus-4-6` | May 2025 |
| `claude-opus-4-5` | May 2025 |
| `claude-haiku-4` | February 2025 |
| `claude-opus-4` / `claude-sonnet-4` | January 2025 |
| 其它 | `null`（不输出） |

### 6.4 `getShellInfoLine` / `getUnameSR`

- Windows 下提示用 Unix shell 语法（`/dev/null` 不是 `NUL`，路径用正斜杠）。
- `getUnameSR` 在 POSIX 上 `osType() + osRelease()` 等价 `uname -sr`；Windows 用 `osVersion() + osRelease()`（`os.type()` 在 Windows 是 `Windows_NT`，不好看）。

### 6.5 `enhanceSystemPromptWithEnvDetails(existingPrompt, model, dirs?, enabledToolNames?)`

给 subagent 的环境信息追加：

- `notes`：cwd 每次 Bash 重置，**只用绝对路径**；最终回里要分享**绝对路径**；不解释读过的代码、只在 load-bearing 时贴代码片段；不用 emoji；不要冒号接 tool call。
- `discoverSkillsGuidance`：主会话的 DiscoverSkills 提示也复刻给 subagent。
- `envInfo`：`computeEnvInfo` 输出。

注释详细说明 subagent 走 `getSystemPrompt` 之外的路径（`AgentTool.tsx:768` 在 `assembleToolPool:830` 之前构造 prompt），所以这个函数是"补偿式"注入。

### 6.6 `DEFAULT_AGENT_PROMPT`

```text
You are an agent for CodePilotX, Anthropic's official CLI for Claude.
Given the user's message, you should use the tools available to complete
the task. Complete the task fully—don't gold-plate, but don't leave it
half-done. When you complete the task, respond with a concise report
covering what was done and any key findings — the caller will relay this
to the user, so it only needs the essentials.
```

用于 subagent 默认行为兜底。

### 6.7 `prependBullets(items)`

把 `Array<string|string[]>` 拍平：

- 单字符串 → ` - xxx`
- 数组 → 每个 ` - xxx`，但额外缩进成 `  - xxx`（视觉上形成子项）

这是把所有 `items` 变成 markdown 列表的统一格式化工具。

---

## 7. 缓存 / 性能优化要点

1. **静态 / 动态切片**：boundary marker → 静态段可跨 org 命中。
2. **DCE'd `require`**：用 `feature('FOO')` 守护的 require 在外部构建里整段消除。
3. **DCE 模式警示**：每个 `process.env.USER_TYPE === 'ant'` 判断都要**内联**，不要提到顶部 const 上（注释反复强调）。
4. **`DANGEROUS_uncachedSystemPromptSection`**：用于"每 turn 都会变但不能因此炸缓存"的场景（MCP 列表、token budget 历史）。会被 `systemPromptSections.ts` 的 `resolveSystemPromptSections` 处理。
5. **attchment 替代 prompt 段**：MCP instructions 改由 `mcp_instructions_delta` 附件投递，避免每 turn 重算；token budget 曾想放 tail attachment，因 `#21577` 路径不读 attachments 失败。
6. **session 切分**：把 2^N 个条件全部挪到 boundary 之后（`getSessionSpecificGuidanceSection`），避免静态 prefix 哈希成 2^N 个变体（PR `#24490`、`#24171` 同类 bug）。

---

## 8. 安全 / 行为红线一览

| 红线 | 出现位置 |
| --- | --- |
| 不生成 / 猜 URL（除非是编程相关的） | `getSimpleIntroSection` |
| `<system-reminder>` 是系统注入，与上下文无强语义关联 | `getSimpleSystemSection`、`getSystemRemindersSection` |
| 怀疑 tool 结果含 prompt injection → 立即报告 | `getSimpleSystemSection` |
| OWASP Top 10 漏洞自查 | `getSimpleDoingTasksSection` |
| `CYBER_RISK_INSTRUCTION`（来自 `./cyberRiskInstruction.ts`） | `getSimpleIntroSection` + proactive 模式 |
| 不可逆 / 共享影响操作必须先确认 | `getActionsSection` |
| 误报防御：不把失败测试说成通过 | `getSimpleDoingTasksSection`（ant only） |
| Verification 强约束（3+ 文件改动 / 后端 / 基础设施） | `getSessionSpecificGuidanceSection`（ant + GrowthBook flag） |
| 自主模式不输出"still waiting" | `getProactiveSection` |
| 用户报告 `CodePilotX` 自身 bug 走 `/issue` 或 `/share` | `getSimpleDoingTasksSection`（ant only） |
| 不发 emoji | `getSimpleToneAndStyleSection`、`enhanceSystemPromptWithEnvDetails.notes` |
| 不用冒号接 tool call | `getSimpleToneAndStyleSection`、`enhanceSystemPromptWithEnvDetails.notes` |
| Subagent 用绝对路径 | `enhanceSystemPromptWithEnvDetails.notes` |
| Undercover 模式抹去所有模型名 / ID | `computeEnvInfo` / `computeSimpleEnvInfo` |

---

## 9. 复盘要点（这张图给模型 / 工程看什么）

1. **6 静态 + 13 动态段** 的拼装模型非常清晰，每段独立可测、可关。
2. **缓存边界**是这套提示词工程上最精心的设计：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` + `DANGEROUS_uncachedSystemPromptSection` 两种机制分别解决"长尾可缓存"和"短尾可爆缓存但合理"两类问题。
3. **"ant vs 外部"双轨文案** 是这套提示词的特征：几乎每个段都有 `process.env.USER_TYPE === 'ant'` 分支，且通过 DCE 在外部构建里消失，对用户完全透明。
4. **Capybara v8 对抗**（PR `#24302`）通过四处 ant-only 子项联合：减少过度注释、提高 assertiveness、防误报、强制自验证。批注清楚说明这些是 A/B 实验、验证后**取消 gating**。
5. **Proactive / KAIROS** 走的是 `TICK_TAG` 心跳 + `Sleep` 工具的"自主循环"模式，UI 重点在用户**不在线**时的高自主度 + 用户**在线**时的协作感。
6. **Verification contract** 是最"硬"的一段：模型必须用对抗验证者（ant only），不可自验、不可自赋 PARTIAL。
7. **DCE 编程模型**对工程纪律要求很高（"inline the USER_TYPE check"），代码注释里反复强调。
8. **可观察性**：`logForDebugging('[SystemPrompt] path=simple-proactive')` 这类轻量 log 提示走的是哪条路径，调试时方便。

---

## 10. 关键命名 / 引用清单

- 工具名（来自各 Tool 的 `constants` / `prompt`）：
  - `AGENT_TOOL_NAME`、`BASH_TOOL_NAME`、`FILE_READ_TOOL_NAME`、`FILE_WRITE_TOOL_NAME`、`FILE_EDIT_TOOL_NAME`、`TODO_WRITE_TOOL_NAME`、`TASK_CREATE_TOOL_NAME`、`ASK_USER_QUESTION_TOOL_NAME`、`SKILL_TOOL_NAME`、`SLEEP_TOOL_NAME`、`GLOB_TOOL_NAME`、`GREP_TOOL_NAME`、`DISCOVER_SKILLS_TOOL_NAME`（feature gated）
- 角色常量：`EXPLORE_AGENT`、`EXPLORE_AGENT_MIN_QUERIES`、`VERIFICATION_AGENT_TYPE`
- 模型常量：`FRONTIER_MODEL_NAME`、`CLAUDE_4_5_OR_4_6_MODEL_IDS`
- 边界 / 文档 URL：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`、`CLAUDE_CODE_DOCS_MAP_URL`
- 注入宏：`MACRO.ISSUES_EXPLAINER`（提 issue 引导，构建期替换）
- 心跳 tag：`TICK_TAG`（来自 `./xml.js`）
- 段落注册：`systemPromptSection`、`DANGEROUS_uncachedSystemPromptSection`、`resolveSystemPromptSections`（来自 `./systemPromptSections.ts`）
- 缓存 / 模式：`shouldUseGlobalCacheScope()`、`isReplModeEnabled()`、`hasEmbeddedSearchTools()`、`isUndercover()`、`isMcpInstructionsDeltaEnabled()`、`isScratchpadEnabled()`、`isForkSubagentEnabled()`、`areExplorePlanAgentsEnabled()`、`getIsNonInteractiveSession()`、`getFeatureValue_CACHED_MAY_BE_STALE()`

---

## 11. 一句话总结

> 这个文件是 **CodePilotX（CodePilotX）系统提示词的"路由器 + 组装器"**：它按"用户类型（ant/外部）、会话模式（proactive/普通/REPL）、特性开关（KAIROS/VERIFICATION/...）"组合出 6 段静态 + 13 段动态内容，通过 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 切成"可缓存 + 不可缓存"两半喂给模型，并在对抗误报、过度注释、跳过验证等行为上对内部版本加严。
