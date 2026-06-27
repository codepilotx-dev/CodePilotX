# 右侧审查边栏原型图改造计划

> 状态：待执行（Phase 1 = UI，Phase 2 = 后端能力占位说明）

## 目标

按原型图改造 `apps/desktop/src/renderer/features/review/WorkspaceReviewSidebar.tsx`，让审查边栏：

1. 顶部 scope 控件从分段控件（segmented）改为下拉菜单，包含 `未暂存 / 已暂存 / 提交 / 分支 / 上轮对话`。
2. 工具栏增加两个新按钮：`提交或推送`（`ArrowUpToLine`）、`创建拉取请求`（`GitFork`），分别打开轻量 inline popover。
3. 工具栏增加 `Briefcase` 切换按钮（tooltip "隐藏文件"），可折叠文件树 + 底部按钮区。
4. 顶部 inline 筛选输入框（placeholder "筛选文件..."）替换现有的 `window.prompt`。
5. 文件列表从扁平改为**可折叠树形结构**，按目录分组。
6. 底部 footer 增加 `还原全部` / `暂存全部` 按钮（unstaged scope）；staged scope 时切换为 `取消暂存全部 / 还原全部`。
7. Phase 1 只做 UI，所有提交/推送/PR/批量操作的处理函数均**占位**（`console.log` 或在错误条显示"即将上线"），真实逻辑作为 Phase 2 占位说明，单独保留待后续实现。

## 不做的事

- 不修改 main / preload / shared 任何 IPC、类型、schema。
- 不动 settings / 任何已存在的 view 切换行为（reviewView 的 inline/split 切换保留）。
- 不动 `RightDock.tsx` 之外的 layout 组件。
- 不动 diff 预览（inline/split）的内部逻辑。
- 不写新测试以外的源码改动；只新增一个针对 `buildReviewFileTree` 的单元测试。

---

## Phase 1：UI 实现

### 1.1 新建文件清单

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `apps/desktop/src/renderer/features/review/buildReviewFileTree.ts` | 工具 | 纯函数：把 `DesktopReviewDiffFile[]` 转为按目录分组的 `ReviewFileTreeNode[]` |
| `apps/desktop/src/renderer/features/review/buildReviewFileTree.test.ts` | 测试 | 单测：empty / flat / nested / 同名不同目录 |
| `apps/desktop/src/renderer/features/review/ReviewFileTree.tsx` | 组件 | 文件树渲染（节点 + 缩进 + 选中态） |
| `apps/desktop/src/renderer/features/review/CommitPopover.tsx` | 组件 | 提交 / 推送 inline popover |
| `apps/desktop/src/renderer/features/review/PullRequestPopover.tsx` | 组件 | PR inline popover |

### 1.2 修改文件清单

| 路径 | 改动摘要 |
| --- | --- |
| `apps/desktop/src/renderer/features/review/WorkspaceReviewSidebar.tsx` | 重写工具栏 / 文件列表 / footer / popover 装配 |
| `apps/desktop/src/renderer/features/review/review.css` | 增加 tree、footer、popover、scope-trigger、search、hide-files 修饰类样式 |
| `apps/desktop/src/renderer/features/layout/rightDockTools.tsx` | 扩展 `RightDockPanelContext.review` 类型（gitStatus / defaultBranch / prompts / Git 工作流回调） |
| `apps/desktop/src/renderer/features/layout/RightDock.tsx` | 把新字段从 props 透传到 `panelContext.review` |
| `apps/desktop/src/renderer/features/layout/DesktopLayout.tsx` | 给 `panelContext.review` 注入 gitStatus / defaultBranch / prompts / Git 工作流回调 |

### 1.3 `WorkspaceReviewSidebar.tsx` 详细改造

#### 1.3.1 新增 state

```ts
const [scope, setScope] = React.useState<DesktopReviewScope>('unstaged')
const [hideFileList, setHideFileList] = React.useState(false)
const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(() => new Set())
const [scopeMenuOpen, setScopeMenuOpen] = React.useState(false)
const [commitPopoverOpen, setCommitPopoverOpen] = React.useState(false)
const [prPopoverOpen, setPrPopoverOpen] = React.useState(false)
const [branchMenuOpen, setBranchMenuOpen] = React.useState(false)

const fileSearchInputRef = React.useRef<HTMLInputElement | null>(null)
```

保留既有 state：`reviewDiff / comments / selectedPath / search / filter / filterMenuOpen / pending / error / draft / isRefreshing`。

#### 1.3.2 新增派生数据

```ts
const reviewTree = React.useMemo(
  () => buildReviewFileTree(visibleFiles),
  [visibleFiles],
)

// 选中文件所在目录自动展开
React.useEffect(() => {
  if (!selectedFile) return
  const dir = selectedFile.path.includes('/')
    ? selectedFile.path.split('/').slice(0, -1).join('/')
    : ''
  setCollapsedDirs(prev => {
    if (!prev.has(dir)) return prev
    const next = new Set(prev)
    next.delete(dir)
    return next
  })
}, [selectedFile?.path])
```

`selectedFile / totals / attachedComments / staleComments / openComments` 计算方式不变。

#### 1.3.3 工具栏渲染顺序（左侧 → 右侧）

| # | 元素 | tooltip | 行为 |
| - | --- | --- | --- |
| 1 | `<PopoverMenu>` 触发按钮 | — | trigger 显示当前 scope 名 + `ChevronDown` + `+X -Y`；菜单内 5 项 |
| 2 | `...`（MoreHorizontal） | "更多" | 占位：仅 `console.log('[TODO] more menu')` |
| 3 | `<PopoverMenu>` filter（Filter 图标） | "筛选" | 沿用现状 filter 项（全部 / 新增 / 修改 / 删除） |
| 4 | Search | "搜索文件" | `fileSearchInputRef.current?.focus()` |
| 5 | **ArrowUpToLine**（新） | "提交或推送" | `setCommitPopoverOpen(true)` |
| 6 | **GitFork**（新） | "创建拉取请求" | `setPrPopoverOpen(true)` |
| 7 | Sliders / Columns2 | "切换到统一差异视图" / "切换到分离视图" | 沿用现状 reviewView toggle |
| 8 | **Briefcase**（新） | hide 时 "显示文件" / 显时 "隐藏文件" | `setHideFileList(v => !v)`；`aria-pressed={hideFileList}` |
| 9 | PanelRight | "关闭右侧边栏" | `onClose()` |

scope dropdown 菜单结构：

```
未暂存                          [withCheck, selected when scope==='unstaged']
已暂存                          [withCheck, selected when scope==='staged']
提交                            [withArrow arrowDirection='right']
分支                            [withArrow arrowDirection='right']
上轮对话                        [withCheck, disabled（Phase 2 启用）]
```

`提交` / `分支` hover 时打开二级面板。`提交` 直接展示 `CommitPopover` 锚定到自身右侧；`分支` 是子 `PopoverMenu` 含两项 `创建分支` / `切到分支...`（后者占位 disabled）。`创建分支` 调用 `onCreateBranch()` → 触发 `DesktopLayout` 的 `setGitWorkflowMode('branch')`。

#### 1.3.4 文件树 + 搜索 + footer（仅在 `!hideFileList` 时渲染）

```tsx
<label className="review-file-search">
  <Search size={APP_ICON_SIZE} />
  <input
    ref={fileSearchInputRef}
    aria-label="筛选文件"
    placeholder="筛选文件..."
    value={search}
    onChange={e => setSearch(e.target.value)}
  />
</label>

<div className="review-file-tree" role="tree">
  {reviewTree.length > 0
    ? reviewTree.map(node => (
        <ReviewFileTreeNode
          key={node.dirPath || '__root__'}
          node={node}
          collapsedDirs={collapsedDirs}
          depth={0}
          selectedPath={selectedFile?.path ?? null}
          onToggleDir={toggleDir}
          onSelectFile={setSelectedPath}
        />
      ))
    : <div className="review-empty-state">{emptyMessage}</div>}
</div>

{scope !== 'lastTurn' && visibleFiles.length > 0 ? (
  <footer className="review-footer">
    {scope === 'unstaged' ? (
      <>
        <Tooltip content="还原所有未暂存变更">
          <button type="button" onClick={revertAll}>还原全部</button>
        </Tooltip>
        <Tooltip content="暂存所有未暂存文件">
          <button type="button" onClick={stageAll}>暂存全部</button>
        </Tooltip>
      </>
    ) : (
      <>
        <Tooltip content="取消暂存所有已暂存文件">
          <button type="button" onClick={unstageAll}>取消暂存全部</button>
        </Tooltip>
        <Tooltip content="还原已暂存变更">
          <button type="button" onClick={revertAll}>还原全部</button>
        </Tooltip>
      </>
    )}
  </footer>
) : null}
```

`toggleDir(dirPath)`：

```ts
setCollapsedDirs(prev => {
  const next = new Set(prev)
  if (next.has(dirPath)) next.delete(dirPath)
  else next.add(dirPath)
  return next
})
```

#### 1.3.5 Popover 装配（始终渲染，挂载在工具栏外层，靠 fixed 定位）

```tsx
{commitPopoverOpen ? (
  <CommitPopover
    open
    anchorRef={commitButtonRef}   // 提交按钮的 ref
    branchName={gitStatus?.branchName ?? 'HEAD'}
    additions={totals.additions}
    deletions={totals.deletions}
    onClose={() => setCommitPopoverOpen(false)}
    onCommit={handleCommit}
    onCommitAndPush={handleCommitAndPush}
    onPush={handlePush}
  />
) : null}

{prPopoverOpen ? (
  <PullRequestPopover
    open
    anchorRef={prButtonRef}
    branchName={gitStatus?.branchName ?? null}
    defaultBranch={defaultBranch}
    additions={totals.additions}
    deletions={totals.deletions}
    onClose={() => setPrPopoverOpen(false)}
    onCreateDraftPR={handleCreateDraftPR}
    onCreatePR={handleCreatePR}
    onOpenPR={handleOpenPR}
  />
) : null}
```

#### 1.3.6 占位处理函数

```ts
function placeholderBanner(message: string): void {
  setError(message)
  window.setTimeout(() => setError(null), 3000)
}

function handleCommit(message: string, includeUnstaged: boolean): void {
  console.log('[TODO] commit', { workspacePath, message, includeUnstaged })
  setCommitPopoverOpen(false)
  placeholderBanner('提交即将上线')
}

function handleCommitAndPush(message: string, includeUnstaged: boolean): void { /* 同上 */ }
function handlePush(): void { /* 同上 */ }
function handleCreateDraftPR(title: string, body: string, pushFirst: boolean): void { /* 同上 */ }
function handleCreatePR(title: string, body: string, pushFirst: boolean): void { /* 同上 */ }
function handleOpenPR(): void { /* 同上 */ }

function revertAll(): void { placeholderBanner('批量还原即将上线') }
function stageAll(): void { placeholderBanner('批量暂存即将上线') }
function unstageAll(): void { placeholderBanner('批量取消暂存即将上线') }
```

`onMoreMenu`（`...` 按钮）：暂时渲染一个 `PopoverMenu` 含 "刷新变更 / 重置宽度 / 关闭右侧边栏" 三项，把现状的 `onRefreshDiff` / `onResetWidth` / `onClose` 包装进去；保留现状最小可用性。

### 1.4 `buildReviewFileTree.ts`

```ts
import type { DesktopReviewDiffFile } from '../../../shared/types.js'

export type ReviewFileTreeNode = {
  dirPath: string            // '' 表示仓库根
  dirLabel: string           // 最后一段或 '(root)'
  children: ReviewFileTreeNode[]
  files: DesktopReviewDiffFile[]
}

export function buildReviewFileTree(files: DesktopReviewDiffFile[]): ReviewFileTreeNode[]
```

实现要点：

- 把每个 `file.path` 按 `/` 切分。
- 用一个 `Map<dirPath, ReviewFileTreeNode>` 缓存已建目录节点。
- 同一父目录下子目录按字母排序，文件按字母排序。
- 只为含 diff 文件的路径建节点（不建空目录）。
- 根目录 `dirPath === ''` 仅在有跨多个一级目录的文件时存在；否则直接返回只含文件的 `[{ dirPath: '', dirLabel: '(root)', ... }]`。

### 1.5 `ReviewFileTree.tsx`

```tsx
type Props = {
  collapsedDirs: Set<string>
  depth: number
  node: ReviewFileTreeNode
  selectedPath: string | null
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
}

export function ReviewFileTreeNode(props: Props): React.ReactNode
```

渲染：

- 目录行：`<button className="review-file-tree-dir" aria-expanded={!collapsed}>` + `ChevronRight/ChevronDown` + `Folder/FolderOpen` + label；缩进 `paddingLeft: 12 + depth * 14`。
- 文件行：`<button className="review-file-tree-row active?">` + 现有 `review-file-badge` + 文件名 + 现有 `review-file-counts`；缩进 `paddingLeft: 12 + (depth + 1) * 14`。
- 子目录递归。

### 1.6 `CommitPopover.tsx`

```ts
type Props = {
  open: boolean
  anchorRef: React.RefObject<HTMLElement>
  branchName: string
  additions: number
  deletions: number
  onClose: () => void
  onCommit: (message: string, includeUnstaged: boolean) => void
  onCommitAndPush: (message: string, includeUnstaged: boolean) => void
  onPush: () => void
}
```

布局（匹配原型图）：

```
┌─ {branchName} v         +{additions} -{deletions} ─┐
│                                                  │
│  提交信息（留空将自动生成）...                   │
│  <textarea>                                      │
│                                                  │
│  [x] 包含未暂存的更改                            │
│                                                  │
│  提交                                Ctrl+Enter │
│  提交并推送                                       │
│  推送                                            │
└──────────────────────────────────────────────────┘
```

- 内部 state：`commitMessage: string`、`includeUnstaged: boolean`（默认 `true`）、`submitting: boolean`（Phase 1 始终 false）。
- 定位：用 `anchorRef.current.getBoundingClientRect()` 计算 fixed 位置（左侧对齐 anchor 右缘，顶部略低于 anchor 顶部）。
- 关闭：`Esc` 键、点击 popover 外部、点击右上角 `X`、触发任一操作后。
- 快捷键：`Ctrl+Enter` 在 textarea focus 时调用 `onCommit`。

### 1.7 `PullRequestPopover.tsx`

```ts
type Props = {
  open: boolean
  anchorRef: React.RefObject<HTMLElement>
  branchName: string | null
  defaultBranch: string | null
  additions: number
  deletions: number
  onClose: () => void
  onCreateDraftPR: (title: string, body: string, pushFirst: boolean) => void
  onCreatePR: (title: string, body: string, pushFirst: boolean) => void
  onOpenPR: () => void
}
```

布局（匹配原型图）：

```
┌─ {branchName} → {defaultBranch}      +{additions} -{deletions} ─┐
│  标题                                                      │
│  <input>                                                   │
│  描述（留空将自动生成）                                    │
│  <textarea>                                                │
│  [x] 提交并推送本地更改                                    │
│                                                             │
│  创建草稿 PR                                  Ctrl+Enter │
│  创建拉取请求                                              │
│  在浏览器中打开 PR                                         │
└─────────────────────────────────────────────────────────────┘
```

- 内部 state：`prTitle`（默认 `branchName`）、`prBody`、`pushFirst`（默认 `true`）。
- 标题右侧 `ExternalLink` 图标点击 = `onOpenPR()`。
- `Ctrl+Enter` 触发 `onCreateDraftPR`。

### 1.8 `review.css` 扩展

新增类（全部限定在 `.review-sidebar` 选择器下）：

```css
.review-scope-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 4px 8px;
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius-3);
  background: var(--c-bg-soft);
  color: var(--c-text-strong);
  font-size: var(--fs-13);
}

.review-file-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--c-border-faint);
  background: var(--c-bg);
  color: var(--c-text-mute);
}

.review-file-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--c-text-strong);
  font-size: var(--fs-13);
}

.review-file-tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.review-file-tree-dir {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 14px;
  border: 0;
  background: transparent;
  color: var(--c-text-soft);
  font-size: var(--fs-13);
  text-align: left;
  cursor: pointer;
}

.review-file-tree-dir:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-strong);
}

.review-file-tree-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 14px;
  border: 0;
  background: transparent;
  color: var(--c-text-soft);
  font-size: var(--fs-13);
  text-align: left;
  cursor: pointer;
}

.review-file-tree-row:hover,
.review-file-tree-row.active {
  background: var(--c-bg-hover);
  color: var(--c-text-strong);
}

.review-footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 14px;
  border-top: 1px solid var(--c-border-faint);
  background: var(--c-bg-soft);
}

.review-footer button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius-3);
  background: var(--c-bg);
  color: var(--c-text-soft);
  font-size: var(--fs-13);
}

.review-footer button:hover {
  color: var(--c-text-strong);
  border-color: var(--c-border);
}

/* 隐藏文件列表 + footer，diff 预览撑满 */
.review-sidebar.hide-files .review-file-search,
.review-sidebar.hide-files .review-file-tree,
.review-sidebar.hide-files .review-file-list,
.review-sidebar.hide-files .review-footer {
  display: none;
}

.review-sidebar.hide-files .review-diff-preview {
  flex: 1 1 auto;
  max-height: none;
}

/* Inline popover 共享样式 */
.review-popover {
  position: fixed;
  z-index: 60;
  min-width: 320px;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius-4);
  background: var(--c-bg);
  color: var(--c-text);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font-family: var(--ff-sans);
}

.review-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--fs-13);
  color: var(--c-text-strong);
  font-weight: 600;
}

.review-popover-header .review-popover-counts {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.review-popover-header strong { color: var(--c-diff-added); font-weight: 500; }
.review-popover-header em { color: var(--c-diff-removed); font-style: normal; font-weight: 500; }

.review-popover textarea,
.review-popover input[type='text'] {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius-3);
  background: var(--c-bg-soft);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-13);
  resize: vertical;
}

.review-popover textarea { min-height: 70px; }

.review-popover-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-13);
  color: var(--c-text-soft);
}

.review-popover-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-3);
  background: transparent;
  color: var(--c-text);
  font-size: var(--fs-13);
  text-align: left;
  cursor: pointer;
}

.review-popover-action:hover {
  background: var(--c-bg-hover);
}

.review-popover-action .shortcut {
  color: var(--c-text-mute);
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
}
```

### 1.9 `rightDockTools.tsx` 类型扩展

```ts
import type { DesktopGitStatus } from '../../../shared/types.js'

export type RightDockPanelContext = {
  review: {
    activeSessionId: string | null
    isRefreshing: boolean
    reviewView: DesktopReviewView
    sessionStatus: DesktopSessionStatus
    workspacePath: string | null
    onClose: () => void
    onOpenWorkspacePath: () => void
    onRefreshDiff: () => void

    // Phase 1 新增
    gitStatus: DesktopGitStatus | null
    defaultBranch: string | null
    commitMessagePrompt: string
    pullRequestPrompt: string
    onCreateBranch: () => void
    onCommitOrPush: () => void
    onCreatePullRequest: () => void
  }
  browser: { /* unchanged */ }
  files:   { /* unchanged */ }
  flags:   RightDockFlags
}
```

### 1.10 `RightDock.tsx` 装配

新增 props：

```ts
gitStatus: DesktopGitStatus | null
defaultBranch: string | null
commitMessagePrompt: string
pullRequestPrompt: string
onCreateBranch: () => void
onCommitOrPush: () => void
onCreatePullRequest: () => void
```

`panelContext.review` 把上述字段透传。

### 1.11 `DesktopLayout.tsx` 装配

把已经在 `DesktopLayout` 范围内的 `gitStatus / commitMessagePrompt / pullRequestPrompt / setGitWorkflowMode` 透给 `<RightDock />`：

```tsx
<RightDock
  // ...existing props
  gitStatus={gitStatus}
  defaultBranch={derivedDefaultBranch}
  commitMessagePrompt={commitMessagePrompt}
  pullRequestPrompt={pullRequestPrompt}
  onCreateBranch={() => setGitWorkflowMode('branch')}
  onCommitOrPush={() => setGitWorkflowMode('commitPush')}
  onCreatePullRequest={() => setGitWorkflowMode('pullRequest')}
/>
```

`derivedDefaultBranch`：从 `gitStatus.upstream` 或仓库默认配置推断；Phase 1 没有时回落 `'main'` 字符串即可。

### 1.12 新增图标导入

`WorkspaceReviewSidebar.tsx` lucide-react 新增：

- `ArrowUpToLine`
- `GitFork`
- `Briefcase`
- `Folder` / `FolderOpen`
- `ChevronRight` / `ChevronDown`
- `MoreHorizontal`
- `X`（popover 关闭按钮）
- `ExternalLink`（PR popover "在浏览器中打开"图标）

`CommitPopover.tsx`：`ArrowUpToLine` / `ArrowUp` / `ArrowDown` / `X`。
`PullRequestPopover.tsx`：`GitFork` / `ExternalLink` / `X`。

---

## Phase 2：UI 所需的后端能力（占位说明，待后续执行）

> Phase 1 中所有 handler 都是占位。这里把每个 handler 最终应该做什么写明，作为后续 PR 的 spec。

### 2.1 IPC: `desktopClient.getWorkspaceReviewDiff` 支持 `'lastTurn'` scope

**`shared/types.ts`** 扩展：

```ts
export type DesktopReviewScope = 'unstaged' | 'staged' | 'lastTurn'

export type DesktopReviewDiffInput = {
  workspacePath: string
  scope: DesktopReviewScope
  sessionId?: string  // scope === 'lastTurn' 时必填
}
```

主进程逻辑：当 `scope === 'lastTurn'`，从 session timeline 重放最后一轮 assistant message，提取它产生的 file-write tool events，构造一个合成的 `DesktopReviewDiffResult`（`status: 'M'`，`additions/deletions` 从行数推算，`hunks` 留空或重新生成）。

启用后：移除 `WorkspaceReviewSidebar` 中 `上轮对话` `PopoverItem` 的 `disabled`。

### 2.2 IPC: 批量 stage / unstage / revert

**推荐做法（低侵入）**：renderer 端循环 `visibleFiles`，逐个调 `desktopClient.applyWorkspaceReviewOperation({ ..., target: { type: 'file', path } })`。提供一个本地 helper：

```ts
async function runOperationOnAllFiles(
  action: 'stage' | 'unstage' | 'revert',
  paths: string[],
): Promise<void> {
  setPending(true)
  const errors: string[] = []
  for (const path of paths) {
    const result = await desktopClient.applyWorkspaceReviewOperation({
      workspacePath, scope, action, target: { type: 'file', path },
    })
    if (result.ok === false) errors.push(`${path}: ${result.error}`)
  }
  setPending(false)
  if (errors.length > 0) setError(errors.join('\n'))
  else onRefreshDiff()
}
```

**替代做法（更高效但侵入）**：在 `DesktopReviewOperationTarget` 增加 `{ type: 'all' }`，main 端做单次批量 RPC。

### 2.3 新增 IPC: `getOpenPullRequestUrl`

**`shared/types.ts`**：

```ts
export type GetOpenPullRequestUrlInput = { workspacePath: string; branch: string }
export type GetOpenPullRequestUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string }
```

**`shared/ipcChannels.ts`**：增加 `'getOpenPullRequestUrl'`。

**`shared/types.ts` `DesktopApi`**：

```ts
getOpenPullRequestUrl(input: GetOpenPullRequestUrlInput): Promise<GetOpenPullRequestUrlResult>
```

**`shared/desktopApiSchema.ts`**：

```ts
const getOpenPullRequestUrlInput = z.object({ workspacePath: z.string(), branch: z.string() })
// …与 commitWorkspaceChanges 同样的模式
```

主进程：调用 `gh pr list --head <branch> --json url --jq '.[0].url'`，回落用 `git remote get-url origin` 拼 `compare` URL。

`PullRequestPopover.onOpenPR` 最终实现：

```ts
const result = await desktopClient.getOpenPullRequestUrl({
  workspacePath, branch: gitStatus.branchName,
})
if (result.ok) await desktopClient.openExternalURL(result.url)
else setError(result.error)
```

### 2.4 各 handler 的真实调用（绑定到 Phase 1 的占位函数上）

| Handler | 真实调用链 |
| --- | --- |
| `handleCommit` | `commitWorkspaceChanges({ workspacePath, message, paths: includeUnstaged ? allChangedPaths : stagedPaths })` |
| `handleCommitAndPush` | `commitWorkspaceChanges(...)` 后 `pushWorkspaceBranch({ workspacePath, setUpstream: !gitStatus.upstream })` |
| `handlePush` | `pushWorkspaceBranch({ workspacePath, setUpstream: !gitStatus.upstream })` |
| `handleCreateDraftPR` | 若 `pushFirst` 先 `pushWorkspaceBranch`，再 `createPullRequest({ workspacePath, title, body, draft: true })` |
| `handleCreatePR` | 同上但 `draft: false` |
| `handleOpenPR` | `getOpenPullRequestUrl(...)` 后 `openExternalURL(url)` |
| `revertAll` | `runOperationOnAllFiles('revert', visibleFiles.map(f => f.path))` |
| `stageAll` | `runOperationOnAllFiles('stage', visibleFiles.map(f => f.path))` |
| `unstageAll` | `runOperationOnAllFiles('unstage', visibleFiles.map(f => f.path))` |

`allChangedPaths` 来自 `gitStatus.files`；`stagedPaths` 过滤 `stagedStatus` 非空的文件。

### 2.5 Phase 2 完成后

- 移除 `placeholderBanner('…即将上线')` 调用。
- `PopoverItem '上轮对话'` 去掉 `disabled`。
- 把 `CommitPopover / PullRequestPopover` 的 `submitting` 与真实 RPC 的 pending/error 状态接通。

---

## 验证（Phase 1）

按 `AGENTS.md`（renderer / shared）约定：

- 无可用的自动化测试 / typecheck 命令配置在该 checkout 中。落地后做一次源码自查：
  - 新增组件的导入 / 导出完整。
  - `review.css` 中所有新 class 的 selector 都限定在 `.review-sidebar` 下。
  - 没有引入未在 `lucide-react` 现有导出里的图标（先 grep 确认 `ArrowUpToLine / GitFork / Briefcase / Folder / FolderOpen / ChevronRight / ChevronDown / MoreHorizontal / X / ExternalLink` 均存在）。
  - `RightDock.tsx / DesktopLayout.tsx` 新增的 props 与调用方一致。
  - `placeholderBanner` 的 `setTimeout` 在组件 unmount 时清理（`useEffect` 追踪 timer id）。
- 桌面应用肉眼验收：
  - 打开一个有未暂存变更的工作区，文件树按目录折叠/展开正确。
  - 顶部 inline 筛选生效。
  - 三个新按钮（提交 / PR / Briefcase）的 tooltip 正确，弹窗/切换行为符合原型。
  - `Briefcase` 切换隐藏后 diff 预览撑满剩余空间。
  - 主题切换（明 / 暗）后样式无错位。

---

## 已确认的设计取舍

1. `分支 ▶` 子菜单两项 `创建分支`（调 `onCreateBranch` 走现有 `GitWorkflowModal('branch')`）/ `切到分支...`（占位 disabled）—— 已确认。
2. Phase 1 中**所有菜单项都不 disabled**，包括 `上轮对话` / `切到分支...`，跟原型一致（不锁住）。
3. 底部 footer + 弹窗 + 任何占位 handler 点击都通过 `setError('批量操作即将上线')` + 3 秒后清除 给反馈，不静默 `console.log`。
4. `Ctrl+Enter` 快捷键绑在 popover 文本域 focus 时 + popover 自身 focus 时都生效 —— 已确认。
5. `Briefcase` 隐藏文件列表时，`hideFileList` 默认 `false`（文件列表默认可见）—— 已确认。
6. scope dropdown trigger 文案始终显示当前 scope 名（`未暂存 / 已暂存 / 上轮对话`）+ counts，跟原型一致 —— 已确认。

Phase 1 已开始执行。