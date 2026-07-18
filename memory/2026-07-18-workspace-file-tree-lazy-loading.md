# 工作区文件树首次打开卡死

## 症状

右侧“打开文件”页首次显示时默认展开所有目录，大型工作区会在扫描和渲染期间明显卡死。

## 根因

1. `workspace/file/list` 使用同步递归 DFS 扫描整个工作区，并对节点串行执行路径校验。
2. `WorkspaceFileTree` 将空的折叠集合解释为所有目录均已展开。
3. 所有可见节点通过普通 `map` 一次性挂载，没有窗口化渲染。

## Codex 对照

Codex 的反编译 Webview 按 `{ workspaceRoot, directoryPath }` 查询单个目录；默认 `expandedPaths` 为空，仅自动展开当前文件的祖先目录。树区域使用固定 28px 行高、overscan 10 的虚拟列表。

## 修复

- 文件列表 RPC 改为目录级查询，只返回指定目录的直接子项。
- 文件树默认全部折叠，展开目录时按需加载，按路径缓存并去重并发请求。
- 当前文件只逐级加载并展开其祖先目录。
- 使用虚拟列表渲染 28px 树行。
- 搜索只过滤已经加载的目录缓存，避免搜索框重新触发全工作区扫描。
- 刷新已打开的嵌套文件时直接读取文件，不再用根目录列表误判文件不存在。

## 回归保护

- WorkspaceService 测试验证根目录及嵌套目录均只返回直接子项。
- 视觉用例验证目录初始为折叠状态、虚拟列表已启用，并在点击后才出现子项。

## 验证

- Renderer typecheck、CSS contract、production build：通过。
- Agent 与 agent-protocol typecheck：通过。
- WorkspaceService：10/10 通过。
- Agent protocol 定向测试：13/13 通过。
- 空文件页暗色/亮色视觉测试：2/2 通过。
- `git diff --check`：通过（仅现有换行符提示）。

状态：DONE
