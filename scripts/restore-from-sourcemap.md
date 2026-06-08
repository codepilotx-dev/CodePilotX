# Sourcemap 源码恢复脚本

本脚本用于将 `src/**/*.{ts,tsx,js,jsx}` 中包含 inline sourcemap 的文件恢复为
`sourcesContent[0]` 的源码，并可选输出统计。

## 规则

- 仅处理 inline sourcemap (`sourceMappingURL=data:application/json...base64,`)，优先匹配 `//#`/`//@`/`//`。
- 仅当 `sourcesContent.length === 1` 时恢复。
- 跳过目录：`dist`、`node_modules`、`src/types/generated`。
- 不处理缺少 sourcemap 或缺失/多项 `sourcesContent` 的文件（作为语义回退保护）。
- 恢复后直接写入源码（即去掉 sourcemap tail，不做启发式反编译）。

## 使用

- `bun scripts/restore-from-sourcemap.mjs --dry-run`
- `bun scripts/restore-from-sourcemap.mjs`
- `bun scripts/restore-from-sourcemap.mjs --verify`

## 最新一次执行结果

- dry-run：552 可恢复 / 1377 无 sourcemap / 1929 文件扫描
- apply：已恢复 552 个文件
- verify：
  - `sourceMappingURL` 剩余：0
  - `react/compiler-runtime` 剩余：0
  - `const $ = _c` 剩余：0

## 验证命令

- `bun run typecheck`
- `bun run build`
- `bun run smoke`（当前环境下失败，见下）
- `bun run check`（当前环境下在执行 `bun dist/claude.js --help` 时失败）

`bun run smoke` 与 `bun run check` 的当前失败点：
- 运行时抛出 `option creation failed due to '-d2e' in option flags`。
- 该失败与本次脚本恢复动作无直接变更关联，指向 CLI 选项定义本体的已有问题。
