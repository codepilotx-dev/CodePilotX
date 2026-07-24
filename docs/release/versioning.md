# 版本管理

## 版本来源

- 根 `package.json` 的 `version` 字段是**唯一产品版本来源**。
- `apps/agent/package.json`、`apps/desktop/electron/package.json`、`apps/desktop/renderer/package.json` 的 `version` 必须与根保持一致。
- `packages/*` 保持独立内部版本，不随产品版本递增。

## 版本格式

遵循严格 SemVer（`MAJOR.MINOR.PATCH-PRERELEASE`），例如 `0.2.0-beta.1`。

| 组成部分 | 规则 |
|---|---|
| `MAJOR` | `0.x` 阶段破坏性变化至少提升 minor；`1.0.0` 后破坏性变化提升 major |
| `MINOR` | 稳定版中兼容功能提升 minor；`0.x` 的功能开发也提升 minor |
| `PATCH` | 修复或性能优化提升 patch |
| `PRERELEASE` | `alpha.N`、`beta.N`、`rc.N`，序号从 1 开始连续递增 |

## 生命周期

```
功能开发 → alpha.N → beta.N → rc.N → 稳定版（无后缀）
```

| 阶段 | 允许变更 | 升版规则 |
|---|---|---|
| `alpha.N` | 新功能、重构、修复 | `0.x.0-alpha.N` → `0.x.0-alpha.N+1` |
| `beta.N` | 修复、小幅完善 | `0.x.0-beta.N` → `0.x.0-beta.N+1` |
| `rc.N` | 仅修复 | `0.x.0-rc.N` → `0.x.0-rc.N+1` |
| 稳定版 | — | 去掉预发布后缀，如 `0.2.0-rc.3` → `0.2.0` |

- Beta 阶段继续时间由**人工决定**，不自动以日期、提交数或版本号触发。
- 只有人工明确宣布稳定后，才允许发布无预发布后缀的版本。
- 功能冻结前不可发布 `rc.N`。

## 标签格式

Git 标签格式：`v<根 package.json 的 version>`。

示例：

| 版本 | 标签 |
|---|---|
| `0.2.0-beta.1` | `v0.2.0-beta.1` |
| `0.3.0-alpha.1` | `v0.3.0-alpha.1` |
| `0.3.0-rc.2` | `v0.3.0-rc.2` |
| `0.3.0` | `v0.3.0` |

标签、manifest 及 CHANGELOG 中的版本在发布时必须一致。

## 变更记录

- 所有变更记录写于根 `CHANGELOG.md`。
- 日常开发写入 `Unreleased` 区段。
- 准备发布时，`version:prepare` 将 `Unreleased` 归档到带日期的版本标题。
- 分类固定为：`Added`、`Changed`、`Fixed`、`Deprecated`、`Removed`、`Security`。
- 每条记录格式：`- [作用域] 中文说明`。

> 修改记录、生成文件或配置必须逐项列出；生成文件需说明生成来源或目的。

## 发布步骤

1. 确认 `Unreleased` 区段非空。
2. 运行 `bun run version:prepare -- <新版本> [--stable]`。
3. 人工检查产物（manifest、lockfile、CHANGELOG）。
4. 人工创建提交和标签。
5. CI 检测到匹配标签后自动构建与签名。

## 常用命令

| 命令 | 说明 |
|---|---|
| `bun run version:check` | 验证四 manifest 一致、lockfile 一致、CHANGELOG 结构有效 |
| `bun run version:check -- --base <git-sha>` | 验证 PR 中 `Unreleased` 有新增说明 |
| `bun run version:check -- --tag <v版本>` | 额外验证标签与 manifest 版本一致 |
| `bun run version:prepare -- <新版本>` | 归档 `Unreleased`、同步 manifest、刷新 lockfile |
| `bun run version:prepare -- <新版本> --stable` | 同上，但允许无预发布后缀的稳定版 |

## 示例

### Beta 递增

```bash
# 当前 0.2.0-beta.1，发布修复后
bun run version:prepare -- 0.2.0-beta.2
# → CHANGELOG 归档 0.2.0-beta.2 (2026-07-25)
# → 四 manifest 同步为 0.2.0-beta.2
```

### Beta 到 RC

```bash
bun run version:prepare -- 0.2.0-rc.1
```

### 显式稳定发布

```bash
bun run version:prepare -- 0.2.0 --stable
```

### 升版拒绝情形

```bash
bun run version:prepare -- 0.2.0-beta.1    # 拒绝：同版本重复
bun run version:prepare -- 0.2.0-beta.0    # 拒绝：序号倒退
bun run version:prepare -- 0.2.0           # 拒绝：缺少 --stable
bun run version:prepare -- v0.3.0-beta.1   # 拒绝：前缀 v 非法
```
