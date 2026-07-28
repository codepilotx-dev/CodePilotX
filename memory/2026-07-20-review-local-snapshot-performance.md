# Review 本地快照性能重构

## 症状

分支审阅首次打开和文件切换都可能长时间停留在加载状态。文件越多，等待越明显；切回 Review 或 watcher 触发后还会清空已加载 Diff，造成重复渲染和闪烁。

## 根因

- `GitReviewService.summary()` 对每个文件分别执行 patch、numstat 和 hash-object，Git 子进程数量随文件数线性增长。
- `review/fileDiff` 会再次调用完整 `summary()`，Renderer 的选中文件加载与大范围 IntersectionObserver 预取把同一问题放大。
- watcher 直接驱动刷新，Renderer 收到更新后整体清空 `loadedDiffs`。
- 这些都是本地 Git 重复扫描；普通 branch 来源并没有必要访问 GitHub。

## 修复

- Agent 按 `projectId + source` 保存会话内快照、patch 索引、标准/隐藏空白文件缓存和共享 in-flight 请求。
- 摘要使用批量 name-status、numstat 和一次流式 patch 扫描；generation 从有序文件 revision 聚合。
- 超过 12 MiB 时继续流式计数和哈希，但不保留完整 patch；显式打开文件才运行 path-specific diff。
- 未跟踪文件直接流式读取本地文件；branch/commit/staged/unstaged/last-turn 不触发远端准备，PR 保持原有远端流程。
- `review/summary` 使用 stale-while-revalidate，`review/refresh` 等待共享刷新；`fileDiff` 不再重跑摘要。
- watcher 250ms 合并、过滤 Git 内部文件和 gitignored 路径，只把最后成功快照标记 stale。
- Renderer 保留 stale/loading 内容，按 `path + revision` 选择性失效；文件请求去重、最大并发 2，预取范围缩小为一屏。

## 回归保护

- 50 个 tracked 文件的摘要 Git 子进程保持固定上限，加载 5 个文件不新增 Git 进程。
- 并发 summary/fileDiff 请求合并。
- stale 快照立即返回旧 generation，显式 refresh 返回新 generation。
- 12 MiB 大文件进入降级模式，显式加载时才生成文件 patch。
- watcher 事件风暴只通知一次，gitignored 文件不触发失效。
- branch 不调用 PR 远端准备器，PR 仍调用。

## 验证

- agent-protocol：30 tests passed。
- Agent：168 tests passed。
- Renderer：167 tests passed。
- 根 typecheck、Agent build、Renderer production build、Renderer css:check 均通过。
