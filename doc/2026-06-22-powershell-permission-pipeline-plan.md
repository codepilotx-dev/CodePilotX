# 修复 PowerShell pipeline 权限误判计划

## 背景

- `log.md` 中权限相关的实际失败主要来自 PowerShell 工具静态检查：
  - `Command contains script block that may execute arbitrary code`
  - `Get-ChildItem uses a parameter or complex path expression ...`
- 其中 `Get-ChildItem | Where-Object { ... }` 这类常见只读搜索命令被脚本块检查误伤。
- 当前桌面端 `workspace-write` 对普通 `Edit`/`Write` 的自动放行已有测试覆盖，但 PowerShell 工具内部 `ask` 会在 headless 链路里表现为 tool result 失败，因此用户体感像权限管理仍然不稳定。

## 根因假设

- `checkScriptBlockInjection()` 只要发现整条命令存在 script block，就要求 pipeline 中所有命令都属于安全脚本块消费者。
- 这会错误地把 `Get-ChildItem` 这类不消费 script block 的普通上游命令也纳入判断，导致 `Get-ChildItem | Where-Object { ... }` 被拒。

## 本轮修改

1. 新增最小回归测试：
   - 验证 `Get-ChildItem ... | Where-Object { ... } | Select-Object ...` 不再被脚本块注入检查误判为 `ask`。
   - 验证危险脚本块消费者仍然保持 `ask`。
2. 修改 `apps/tui/src/tools/PowerShellTool/powershellSecurity.ts`：
   - 只对参数元素中实际包含 `ScriptBlock` 的命令应用安全消费者白名单。
   - 保持危险 cmdlet 优先拦截。
3. 验证：
   - 先运行新增测试确认失败。
   - 修改后运行新增测试确认通过。
   - 再运行 PowerShell 工具相关可用测试或至少运行 `bun test` 针对新增测试文件。

## 后续可做

- 继续排查 `Get-ChildItem -Recurse -Path ... | Select-Object ...` 触发 `complex path expression` 的场景，判断是静态路径提取误判还是命令写法确实无法验证。
- 桌面端可以补一个 workflow 层测试：PowerShell `ask` 在 embedded headless 下应投影成可见权限请求，而不是只显示 tool result 失败。
