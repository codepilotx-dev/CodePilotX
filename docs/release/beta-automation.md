# Beta 自动发布

## 目标与边界

仓库使用一台专用 Windows x64 电脑作为 self-hosted runner，自动处理受保护 `main` 上的下一版 Beta：

1. `main` 合入有效 `Unreleased` 内容后等待 30 分钟静默期。
2. 将当前 `X.Y.Z-beta.N` 单步递增为 `X.Y.Z-beta.N+1`。
3. 在发布机完成完整检查、Windows 打包及安装冒烟。
4. 创建 Release PR，等待远端 CI 全部通过并自动合并。
5. 为合并提交创建签名 annotated tag，由现有标签工作流发布 GitHub prerelease。

自动化不会决定 Beta → RC、RC → Stable 或新的 `MAJOR.MINOR.PATCH` 版本线。这些变化必须由人工确认并按人工发布流程执行。`Unreleased` 为空、当前版本不是 beta、当前版本尚未发布、标签冲突或 GitHub 状态不一致时，自动化停止，不猜测目标版本。

## 两阶段流程

### Prepare

`.github/workflows/prepare-beta-release.yml` 在 `main` push、每小时恢复检查或手动触发时运行。普通 push 等待静默期后重新核对远端 `main` SHA；期间有新提交时，旧候选退出并由新任务重新计时。

当 `BETA_RELEASE_AUTOMATION_ENABLED=false` 时，push 和 schedule 继续跳过；从 `main` ref 发起的 `workflow_dispatch` 仍可按 `dry_run` 输入执行人工演练或正式 Prepare。手动任务必须同时传入 40 位 `main_sha`，checkout 该提交并确认执行时它仍等于 `origin/main`；候选变化后旧确认不能继续发布。非 `main` ref 的手动任务不能进入发布 Environment。

Prepare 调用现有 `version:prepare` 归档 CHANGELOG 和同步版本，不复制升版逻辑。推送 Release 分支前依次执行冻结依赖安装、版本与标签一致性检查、全仓类型检查和单元测试、CSS 与依赖安全检查、Renderer 无障碍测试、Windows 打包、安装及桌面启动冒烟，以及 `git diff --check` 和文件范围校验。

全部通过后才创建 `automation/release-v<version>-<baseSha7>` 分支及 `chore(release)：准备 <version>` 签名提交，为 PR 添加 `automation:beta-release` 标签并开启 auto-merge。Release PR 只能改动 `CHANGELOG.md`、四个产品 manifest 和 `bun.lock`。如果验证期间 `main` 前进，自动化只关闭自己创建的过期 PR，不强推或改写其他分支。

### Finalize

`.github/workflows/finalize-beta-release.yml` 在 `main` push、每小时恢复检查或手动触发时运行。它只接受由可信身份创建、带机器可读 base SHA/版本标记及 `automation:beta-release` 标签的已合并 Release PR；普通 `main` 合并立即退出。

自动化变量关闭时，人工流程可从 `main` ref 手动 dispatch Finalize，并将已合并 Release PR 的 40 位 merge SHA 作为 `main_sha` 传给现有 `finalize`。push 也只 finalize 自身的 `github.sha`；仅启用自动化后的 schedule 使用无目标约束的 `reconcile` 恢复发布。

Finalize 核对 PR base/head、签名、必需检查和 merge SHA，然后创建指向该 merge commit 的签名 annotated tag，说明为 `chore(release)：发布 v<version>`。标签已存在且指向同一 SHA 视为幂等成功；同名标签指向其他 SHA 时停止。

标签触发的 `.github/workflows/windows-x64-package.yml` 必须先确认目标属于 `main` 历史，再在 GitHub-hosted Windows runner 上构建并发布。成功结果必须是 prerelease，且包含安装包、blockmap、对应的 `beta.yml`、`SHA256SUMS.txt` 和 SPDX JSON SBOM。

## 发布机配置

### Runner

- 使用 Windows 10/11 x64 常开电脑，禁用自动睡眠。
- 创建专用本地标准用户，以 Windows 服务运行 GitHub Actions runner；不要使用日常管理员账户。
- 安装 Bun 1.3.14、Git、GitHub CLI、PowerShell、Chrome 和仓库当前 Windows 打包依赖，并启用 Git 长路径。
- 将 runner 注册到本仓库，只添加专用标签 `codepilotx-release`，工作流选择器为 `[self-hosted, windows, x64, codepilotx-release]`。
- 公开仓库中的任何 `pull_request`、来自 fork 的代码或其他不可信事件，绝不能调度到 self-hosted runner。PR CI 继续使用 GitHub-hosted runner；发布机只运行 `main` 上仓库自身的 prepare/finalize 工作流。

### GitHub 凭据

为当前 GitHub 身份创建仅限本仓库的 fine-grained PAT：

| 权限 | 级别 |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Actions | Read and write |
| Issues | Read and write |
| Metadata | Read-only |

在无人工审批的 `beta-release` Environment 中保存 secret `RELEASE_BOT_TOKEN`，并将 Environment 限制为 `main` 上的发布工作流使用。不要把 PAT 写入仓库、日志、Issue、Git 配置或 runner 工作目录；轮换时先替换 Environment secret，再撤销旧令牌并执行一次 dry-run。

### 提交与标签签名

在发布机的 runner 服务账户下生成独立 ED25519 SSH 签名密钥。私钥 ACL 只允许该服务账户读取，公钥添加到当前 GitHub 账户的 signing keys；另创建仅含已验证邮箱与该公钥的 `allowed_signers` 文件供本机验签。配置：

```powershell
git config --global user.name "Xiao Hi"
git config --global user.email "xouyang525@gmail.com"
git config --global gpg.format ssh
git config --global user.signingkey "C:/path/to/release-signing-key.pub"
git config --global gpg.ssh.allowedSignersFile "C:/path/to/allowed_signers"
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

实际私钥路径由发布机管理员设置，不写入仓库或故障报告。上线前使用临时本地提交和 annotated tag 验证 `git log --show-signature`、`git tag --verify` 及 GitHub 的 Verified 状态。

### 仓库变量与标签

创建以下 Actions variables：

| 变量 | 初始值 |
|---|---|
| `BETA_RELEASE_AUTOMATION_ENABLED` | `false` |
| `BETA_RELEASE_QUIET_MINUTES` | `30` |
| `RELEASE_BOT_LOGIN` | `xiaohai-ouyang` |

仓库需存在 `release-automation` 和 `automation:beta-release` 标签。首次部署保持自动化禁用；不要在 runner、凭据和 dry-run 尚未验收时提前改为 `true`。

## 状态、重试与恢复

`scripts/beta-release.ts` 从 Git/GitHub 派生状态，不依赖只保存在发布机上的游标：

| 状态 | 含义 |
|---|---|
| `idle` | 没有可发布的 `Unreleased` 内容 |
| `candidate` | 已识别下一版 beta，尚未创建 Release PR |
| `prepared` | Release PR 已创建或等待合并 |
| `publishing` | Release PR 已合并，标签或 GitHub Release 正在处理 |
| `published` | prerelease 和全部预期附件已发布 |
| `blocked` | 发现语义冲突或不可安全自动恢复的终态故障 |

关机、断网或 Actions 中断后，每小时任务调用 `reconcile` 恢复。网络及无副作用的瞬时失败最多重试 3 次；重复运行必须复用已确认的分支、PR 或同 SHA 标签，不创建平行版本。已发布 Release 不得覆盖；草稿已有部分附件时不得删除或替换，立即进入 `blocked`。

终态失败创建或更新 `[release automation] <version> 发布阻塞` Issue，只包含版本、SHA、阶段、重试次数和 Actions URL，不包含本机路径、环境、设置、凭据或构建内容。对应版本成功后自动关闭该 Issue。

## 手动 Beta 发布 Skill

仓库提供 `.agents/skills/codepilotx-beta-release`，支持仓库 Skill 的 Agent 可从仓库根目录发现。常用调用：

```text
使用 codepilotx-beta-release skill 查看状态
使用 codepilotx-beta-release skill 发布下一版 Beta
使用 codepilotx-beta-release skill 恢复上次 Beta 发布
```

手动发布模式适合保持 `BETA_RELEASE_AUTOMATION_ENABLED=false` 的仓库。它只选择 `dev` 本地或远端 ref 中已经提交的 commit；当前 checkout 中 staged、modified 和 untracked 内容会被列为“未包含”，不会被暂存、提交、stash、回退或覆盖。本地版本门禁在候选 commit 的临时 detached worktree 中运行，因此 dirty workspace 不会混入候选。

调用发布模式即授权 Skill 推送 `dev` 已提交 commit、创建或复用 `dev → main` PR、添加 `release-automation` 标签并开启 GitHub auto-merge。普通集成 PR 不使用 `automation:beta-release`，该标签只属于升版 Release PR。PR 的现有远端 CI 必须全部通过；代码、测试、a11y、SQLite、性能或打包失败时，Skill 只报告根因并停止，不修改产品代码或降低门禁。

`dev → main` 合并后，Skill 锁定 `mainSha`，从 `main` ref 同时传入 `dry_run=true` 和该 `main_sha` dispatch Prepare dry-run，等待发布机完成升版模拟、全仓验证、Windows 打包和安装冒烟。演练成功后只询问一次精确确认 `发布 vX.Y.Z-beta.N`；main SHA 或候选版本变化会使确认失效。确认后 Skill 用同一 `main_sha` dispatch live Prepare，等待可信 Release PR 自动合并，再以 Release PR merge SHA 手动 dispatch live Finalize。workflow run-name 同时记录 dry-run/live 阶段和锁定 SHA，供并发运行精确关联。升版、签名 commit、签名 tag、Release 和附件仍完全由现有状态机及 workflows 创建。

重复调用恢复模式时，Skill 从 GitHub 和 Git 派生状态并复用已有 PR、workflow、同 SHA 标签或 Release。它不会删除 draft、覆盖标签、替换附件、复用旧版本标签或把 Beta 自动提升为 RC/Stable。最终成功必须验证 prerelease 非 draft，标签属于 `main` 且指向 Release PR merge commit，并包含 exe、blockmap、`beta.yml`、`SHA256SUMS.txt` 和 SPDX JSON SBOM。

人工接管时先运行：

```powershell
bun scripts/beta-release.ts inspect --main-sha <main-sha> --json
bun scripts/beta-release.ts reconcile --dry-run
```

确认 GitHub 上的 PR、标签、草稿 Release 和附件状态后，再修复导致阻塞的外部状态并重新运行 `reconcile`。不得通过删除 Release、覆盖标签或跳过版本校验来“恢复”发布。

## 首次上线

1. 合并自动化代码，保持 `BETA_RELEASE_AUTOMATION_ENABLED=false`。
2. 配置 runner 服务、PAT、Environment、签名密钥、仓库变量和标签。
3. 手动触发 `prepare-beta-release`，设置 `dry_run=true` 并传入当前 40 位 main SHA。
4. 确认候选版本、签名检查、本地安装包及“未创建分支、PR、标签、Release、Issue”的无副作用保证。
5. 将 `BETA_RELEASE_AUTOMATION_ENABLED` 改为 `true`，等待小时级 schedule 执行一次 live `reconcile`。
6. 观察 Release PR 的必需检查和 auto-merge；合并后确认标签只指向 merge commit，最终 prerelease 附件完整。

发布机离线时任务可保持排队；恢复上线后由小时级 reconcile 继续。任何 RC、Stable、版本线变化或状态冲突均保留给人工处理。
