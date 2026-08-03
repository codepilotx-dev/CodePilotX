---
name: codepilotx-beta-release
description: 手动检查、发布或恢复 CodePilotX 当前版本线的下一版 Beta。用于从 dev 已提交内容创建并自动合并 dev → main PR，在维护者 Windows 工作站生成签名本地预检证明，由发布机执行环境 dry-run，并在唯一一次正式确认后复用 dry-run 回执、Release PR、签名标签和 GitHub prerelease 流程；不得用于 RC、Stable 或新版本线。
---

# CodePilotX 手动 Beta 发布

## 先确定模式

将用户意图归入且只归入以下模式之一：

- **查看状态**：只读报告 `dev/main`、dirty 文件、PR、Actions、版本和 Release 状态。
- **发布下一版 Beta**：从 `dev` 已提交内容开始完整发布。
- **恢复上次 Beta 发布**：从 Git 和 GitHub 恢复已有 PR、workflow、标签或 Release。

用户未明确模式但表达“发布下一版 Beta”时使用发布模式。版本不是 `X.Y.Z-beta.N`、用户要求 RC/Stable 或新版本线时立即停止。

## 读取唯一运行手册

执行任何命令前，完整读取 [references/manual-runbook.md](references/manual-runbook.md)。严格按照其中的阶段、命令约束、身份标记和恢复规则操作。不要凭经验发明新的升版、提交、标签、Release 或附件处理逻辑。

## 不可破坏的边界

- 只发布 `refs/heads/dev` 或 `origin/dev` 已提交的对象。当前工作区的 staged、modified 和 untracked 内容一律列为“未包含”。
- 不得对当前 checkout 执行 `git add`、`git commit`、`git stash`、`git reset`、`git clean`、文件 checkout、rebase 或强推。
- 本地质量验证只通过 `bun run beta:preflight -- --main-sha <sha>` 在系统临时目录的 detached worktree 中执行；连续两次必须得到相同 `releaseTreeSha`。移除 worktree 前必须确认它属于本次运行且 tracked/untracked 状态均为空，禁止 `--force` 清理。
- `scripts/beta-release.ts` 是版本和发布状态的唯一真源；Prepare、Finalize 和标签发布 workflows 是唯一发布执行入口。
- 手动 Prepare 必须传入已经验证的 40 位 `main_sha`、24 小时内本地 SSH 证明及其 digest；dry-run 成功后，live 还必须传入同一证明、成功 run ID 和唯一回执。Finalize 只接受已合并 Release PR 的 merge SHA。不得用无目标约束的手动 `reconcile` 代替。
- 不得手工编辑产品版本、归档 CHANGELOG、创建标签、创建 GitHub Release、删除 draft、覆盖标签或替换附件。
- 不得读取或打印 GitHub Environment secret。调用本地只读 `inspect` 时，只能将 `gh auth token` 临时放入当前子进程的 `RELEASE_BOT_TOKEN`，并在命令结束后立即清除。
- `BETA_RELEASE_AUTOMATION_ENABLED` 必须保持 `false`。无本地证明的 push/schedule 不得 Prepare，本 Skill 不创建定时任务。
- 代码门禁失败时只诊断并停止；不得修改产品代码、降低预算、跳过测试或自动生成修复提交。

## 发布授权

调用发布模式即授权：推送本地 `dev` 已提交 commit、创建或复用 `dev → main` PR、添加发布标签、开启 auto-merge，以及触发无副作用 dry-run。以上步骤不再重复询问。

dry-run 完整成功后，展示候选版本、main SHA 和 Actions URL，并且只在此处请求一次精确确认：

```text
发布 vX.Y.Z-beta.N
```

未收到完全匹配的确认文本时，不得触发 live Prepare 或 Finalize。确认只对展示的版本、main SHA、proof digest 和 dry-run ID 有效；live Prepare 必须复用同一 `main_sha`、证明与回执。任一值变化或证明/回执过期后必须重新本地预检、dry-run 并重新确认。

## 完成标准

只有同时满足以下条件才能报告成功：

- `dev → main` PR 和可信 Release PR 均已合并；
- 签名 annotated tag 指向 Release PR merge commit，且该 commit 属于 `main` 历史；
- GitHub Release 已发布、为 prerelease 且非 draft；
- Release 包含 exe、blockmap、`beta.yml`、`SHA256SUMS.txt` 和 SPDX JSON SBOM；
- 同版本阻塞 Issue 已由现有状态机关闭或不存在。

最终输出 dev PR、dry-run、live Prepare、Release PR、Finalize、标签构建和 GitHub Release 的链接。若停止，输出准确阶段、失败命令、失败检查、Actions URL 和下一步，不输出令牌、本机敏感路径或环境内容。
