Core migration progress

- Started Wave 0 on branch codex/openai-permissions-model.
- Wave 0 complete: unsupported core error, app/core boundary guard, desktop TUI import baseline guard.
- Wave 1 partial complete: OAuth crypto/types and pure permission rule/result/shell matching moved to core with TUI re-export compatibility.
- Wave 2 partial complete: appServer protocol/server contract added to core; desktop JSON-RPC bridge imports core.
- Wave 3 partial complete: desktop headless runtime facade, control types, permission mode, env constants, context window, MCP/model/settings facades added to core; selected desktop main imports switched.
Task 1: complete (commits f21e3ba7d..206098cc5, review clean)
Task 2: complete (commits 206098cc5..72789cc5f, review clean, indentation fix amended)
Task 3: complete (commits 72789cc5f..273bed9a6, review clean)
Task 4: complete (commits c0a7ceb6b..e65301251, fix dispatch)
