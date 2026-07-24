# DEBUG REPORT：火绒删除打包后的 Agent

- **Symptom:** Windows 双架构 NSIS 打包时，7-Zip 报 `resources/agent/codepilotx-agent.exe` 不存在；火绒安全日志显示该文件被识别为 `HackTool/Mikatz.a` 并删除。
- **Root cause:** `apps/agent/src/security/ShellRiskClassifier.ts` 为阻止凭据窃取命令，包含 `mimikatz`、`sekurlsa`、`lsass` 等静态正则字面量。`bun build --compile` 将这些字符串嵌入未签名的 Agent EXE，触发火绒静态特征检测。图标资源及 Electron 图标注入与该命中无关。
- **Fix:** 未修改安全分类器、未关闭病毒防护、未添加信任区。修改或拆分安全规则属于图标任务之外的安全架构决策。
- **Evidence:** 源 EXE SHA-256 为 `DA3461E4EA5A2FF3D2D16FB10B92C9833C43E90BCD17334BED7AAC0A0E6A43F7`，Authenticode 状态为 `NotSigned`；二进制中可检出上述三个字符串，源码中存在对应拒绝规则；火绒日志记录删除的目标路径和 electron-builder 进程。
- **Regression test:** 无。未实施代码修复；需要厂商误报复核、代码签名或明确批准的打包架构调整后再补充。
- **Related:** Bun 官方曾说明 Windows 杀毒软件和文件锁行为会影响其 I/O/构建流程；本次是火绒实时监控删除生成文件。
- **Status:** `BLOCKED`——应用图标已成功注入 x64/arm64 解包 EXE，但安装器生成被安全软件删除 Agent 文件所阻止。
