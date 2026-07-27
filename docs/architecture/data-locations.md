# CodePilotX 数据目录边界

CodePilotX 将持久化内容分为用户数据、工作区配置、Electron 状态和安装资源。不同类别不能互相回退或混写。

## 用户数据根

默认位置是 `%USERPROFILE%\.codepilotx`。用户可在“设置 → 配置 → 数据位置”选择新的父目录，桌面端会使用该父目录下的 `.codepilotx`。选择后应用立即重启，在 SQLite 打开前把当前用户数据复制到同盘 staging，再原子发布目标目录；旧目录不会删除。

用户数据根包括：

- `history.sqlite`、`profile.sqlite` 及其 WAL/SHM；
- `pi-models.cache.json`（Pi 模型目录缓存；旧 `models.cache.json` 仅原样保留，不再读取）；
- 全局 `hooks.json` 和 `skills`；
- `attachments`、`pets`、`tooling`、`workspaces`；
- Agent `logs`；
- 不含绝对路径的数据迁移标记。

其中数据库、附件、全局配置和已安装宠物应备份。模型目录缓存、Agent 日志、可重新安装的托管工具以及已结束的隔离工作树可重建，但迁移时仍会保留。

API Key 与 OAuth 值以密文保存在 `profile.sqlite`，主密钥由 Windows 系统凭据库保管。迁移数据库不会导出主密钥或明文凭据。

## 工作区配置

`<workspace>\.codepilotx` 只保存用户明确创建、适合随项目共享的内容：

```text
.codepilotx\
  hooks.json
  skills\
    <name>\
      SKILL.md
      scripts\
      assets\
```

项目 Hook 执行前必须通过现有信任确认。CodePilotX 兼容读取工作区的 `.agents\skills`、`.codex\skills` 和 `.claude\skills`，但不管理这些目录。

数据库、日志、附件、宠物、工具链、记忆、UI 状态和子 Agent worktree 不得写入工作区 `.codepilotx`。项目记忆保存在用户数据库中，并以规范化工作区路径的哈希隔离。

## Electron AppData

Electron `userData` 保存窗口位置、外观、宠物浮窗位置、Chromium Cache、Local Storage、Session Storage 和 Network 状态。桌面主进程日志使用 Electron logs 目录。

`data-location.json` 也保存在 AppData，因为它必须在自定义用户数据根尚未挂载或迁移失败时仍可定位当前目录。该文件只保存当前目录、待迁移目录和操作 ID，不保存会话、凭据或工作区内容。

## 安装资源与系统目录

安装目录只包含随版本发布的只读资源：Agent 可执行文件、Renderer、模型快照、图标、许可证和 notices。运行时不得创建 `<安装目录>\.codepilotx`，CodePilotX 不提供默认或隐式便携模式。

无项目任务的用户文档位于 `%USERPROFILE%\Documents\CodePilotX`。凭据主密钥和操作系统临时文件分别由 Windows 凭据库和系统临时目录管理，不迁入任何 `.codepilotx`。

## 显式覆盖

直接启动 Agent 或测试时可使用 CodePilotX 专用环境变量覆盖数据根或子目录。桌面端检测到 `CODEPILOTX_DATA_DIR` 时只读展示实际位置，并禁用目录选择，避免桌面引导文件与外部启动参数产生两套来源。
