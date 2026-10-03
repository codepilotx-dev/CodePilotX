# CPX-CUA upstream (cua-driver)

- Project: [trycua/cua](https://github.com/trycua/cua), `libs/cua-driver`
- Imported commit: `32b34fbc75abeb96af77df49ae0da72328e67707`
- License: MIT (Copyright (c) 2025 Cua AI, Inc.)
- Imported on: 2026-10-03

## 引入范围

Windows x64 后台优先控制所需的完整依赖闭包：`cua-driver-core`、
`cua-driver-contract`、`platform-windows`（含 `uia`、`win32`、`input`、`tools`
与截图实现）、`cursor-overlay`、`pip-preview`。首个版本只构建
`crates/cpx-cua`，它把上游注册表裁剪为发现、读取和输入所需的工具集。

未引入上游的 Spaces、虚拟机镜像、Python／TypeScript SDK、视觉识别扩展、其他
平台后端（macOS／Linux）和独立产品功能。

依赖版本锁定在上游 `Cargo.lock`；CPX 不自动追随上游，更新由 CPX 手动评估后合入。

## 对上游源码的改造

- `cua-driver-core` 默认特性仅保留 `yaml`，关闭首版不使用的 `rego`，避免 Windows 构建额外要求 Spectre 运行库；保留对应源码与锁定依赖。
- `crates/cpx-cua` 为 CPX 新增的 stdio 入口，复用上游 MCP wire、注册表与
  Windows 工具实现，产物与宿主标识统一为 `cpx-cua.exe`／`CPX-CUA`。
- `cua-driver-core` 的风险分类与私有观察操作表新增 `cpx_apps`，使其与
  `list_windows` 同级别（R2、`private_observation`）；该工具由 CPX 入口提供，
  用于返回宿主解析出的应用身份（AUMID 或规范化可执行文件路径）和进程代际。
- 每个需要目标身份的工具在调用前校验 `cpx_app_id`／`cpx_process_key` 与宿主
  解析结果一致，否则拒绝执行并要求重新观察。

## 上游自身包含的第三方来源

`NATIVE_NOTICES.md` 记录上游从 trope-cua、Interface-Agent 和 yabai 引入的
部分及其许可证。
