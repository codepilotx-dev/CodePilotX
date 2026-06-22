# Rust 迁移决策记录

## 当前结论
- 暂不迁移主循环到 Rust。
- 先用 TypeScript/Bun 引入 JSON-RPC app-server，把 thread/turn/item/event 协议边界稳定下来。
- Rust 进入后续评估，不进入本轮主验证链。

## 依据
- 当前仓库没有 `Cargo.toml`、`.rs` 或 Rust toolchain 配置。
- 现有主循环、provider、工具、权限、transcript 和桌面适配都在 TypeScript/Bun 体系内。
- 仓库已经依赖 `vscode-jsonrpc`，并已有 LSP JSON-RPC stdio 客户端经验。
- `ThreadRuntime` 和 `ThreadEvent` 已经提供可承接 app-server 的最小协议模型。

## 进入 Rust 实施计划的门槛
- TypeScript app-server 无法稳定承载多客户端并发。
- 沙箱或权限隔离必须依赖 native 层实现。
- 事件持久化、回放或协议处理性能成为明确瓶颈。
- 产品目标要求与上游 Codex Rust protocol 高兼容，而 TS 适配成本超过迁移成本。

## 下一步
- 本轮只交付 TS JSON-RPC app-server。
- 后续如触发门槛，再新增独立 Rust spike 计划，不与当前 TypeScript app-server 首版混做。
