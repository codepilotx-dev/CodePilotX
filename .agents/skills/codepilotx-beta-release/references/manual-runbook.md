# CodePilotX 手动 Beta 发布运行手册

本手册只编排 GitHub 和现有发布入口，不实现第二套发布状态机。所有 PowerShell 命令均从仓库根目录执行，所有文本按 UTF-8 处理。

## 1. 固定对象与禁止事项

- 仓库：`codepilotx-dev/CodePilotX`
- 集成分支：`dev`
- 受保护分支：`main`
- 普通集成 PR 标签：`release-automation`
- Release PR 标签：`automation:beta-release`
- Prepare workflow：`prepare-beta-release.yml`
- Finalize workflow：`finalize-beta-release.yml`
- 标签发布 workflow：`windows-x64-package.yml`
- dev PR marker：`<!-- codepilotx-manual-beta source=dev sha=<40位SHA> -->`

不得将 `automation:beta-release` 用于 `dev → main` PR。不得调用 `gh release create/upload/delete` 或 `git tag`；这些副作用只允许现有发布状态机和标签 workflow 执行。

## 2. 共同预检

先执行并保留结果，不输出任何 token：

```powershell
git status --short --branch
git remote get-url origin
git show-ref --verify refs/heads/dev
bun --version
git --version
gh --version
gh auth status
gh repo view --json nameWithOwner
gh variable get BETA_RELEASE_AUTOMATION_ENABLED
gh api repos/codepilotx-dev/CodePilotX/actions/runners `
  --jq '.runners[] | {name, status, busy, labels: [.labels[].name]}'
```

要求：

1. `nameWithOwner` 必须是 `codepilotx-dev/CodePilotX`。
2. Bun 必须是 `1.3.14`。
3. 自动化变量必须是 `false`。
4. 至少一个 online runner 同时具有 `self-hosted`、`Windows`、`X64` 和 `codepilotx-release` 标签。
5. `gh` 必须能读取 Actions、PR、Release 和仓库变量；权限不足时停止，不改权限或凭据。

将 `git status --porcelain=v1 --untracked-files=all` 的每一行原样列入“本次发布未包含的工作区内容”。不要读取这些文件来判断发布候选，也不要改变它们。

## 3. 选择唯一 committed dev 候选

允许 `git fetch --prune origin main dev` 和 `git fetch --tags origin` 更新远端引用，但不得切换当前 checkout。记录：

```powershell
$localDev = (git rev-parse refs/heads/dev).Trim()
$remoteDev = (git rev-parse refs/remotes/origin/dev).Trim()
$remoteMain = (git rev-parse refs/remotes/origin/main).Trim()
```

按祖先关系选择：

- SHA 相同：候选是该 SHA。
- `origin/dev` 是本地 `dev` 的祖先：候选是本地 `dev`；使用 `git push origin refs/heads/dev:refs/heads/dev` 仅推送 committed objects，然后重新读取 `origin/dev`。
- 本地 `dev` 是 `origin/dev` 的祖先：候选是较新的 `origin/dev`，不移动本地 ref。
- 两者都不是对方祖先：本地和远端已分叉，停止。

禁止 force push。推送后必须确认远端 `dev` 等于候选 SHA。使用 `git rev-list --left-right --count origin/main...origin/dev` 报告相对差异；`dev` 落后 `main` 本身不是失败。

## 4. 临时 detached worktree

需要运行本地脚本时，使用系统临时目录下的唯一绝对路径，并在添加前确认路径不存在：

```powershell
$releaseRunId = [guid]::NewGuid().ToString('N')
$releaseWorktree = Join-Path ([System.IO.Path]::GetTempPath()) "codepilotx-beta-$releaseRunId"
if (Test-Path -LiteralPath $releaseWorktree) { throw '临时 worktree 路径已存在' }
git worktree add --detach $releaseWorktree $candidateSha
```

在 worktree 中运行普通 PR 版本门禁，base 使用已记录的 main SHA：

```powershell
bun run version:check -- --base $remoteMain
git diff --check $remoteMain...$candidateSha
```

任何命令失败都停止发布。清理时先确认 resolved path 仍位于系统临时目录、本次 GUID 匹配，并执行：

```powershell
$dirty = git -C $releaseWorktree status --porcelain=v1 --untracked-files=all
if ($dirty) { throw '临时 worktree 非空，保留现场且禁止强制删除' }
git worktree remove $releaseWorktree
```

不要使用 `git worktree remove --force`，不要删除无法证明属于本次运行的目录。

## 5. 查看状态模式

查看状态不得推送、创建或编辑 PR、触发 workflow、改变变量、创建标签或修改 Issue。允许 fetch 和只读 `gh` 查询。

报告：

- local/origin dev SHA、main SHA 和 ahead/behind；
- 被排除的 dirty 路径；
- `head=dev base=main` 的开放 PR；
- 带 `automation:beta-release` 的开放或近期已合并 PR；
- Prepare、Finalize 和标签 workflow 最近运行；
- 当前 prerelease 和预期附件；
- 使用 main committed worktree 执行的 `inspect --json` 状态。

使用稳定字段查询 Release 和发布构建，避免猜测 `gh` JSON 字段：

```powershell
gh release list --limit 10 --json tagName,isDraft,isPrerelease,createdAt,name
gh release view <currentTag> --json tagName,isDraft,isPrerelease,assets
gh run list --workflow windows-x64-package.yml --event push --limit 10 `
  --json databaseId,headSha,event,status,conclusion,createdAt,url
gh issue list --state open --search '"[release automation]" in:title 发布阻塞' `
  --json number,title,url
```

本地 inspect 只能这样临时传递当前 `gh` 凭据，禁止回显变量：

```powershell
$releaseGhToken = (gh auth token).Trim()
if (-not $releaseGhToken) { throw '无法取得当前 gh 凭据' }
$env:RELEASE_BOT_TOKEN = $releaseGhToken
try {
  bun scripts/beta-release.ts inspect --main-sha $mainSha --json
} finally {
  Remove-Item Env:RELEASE_BOT_TOKEN -ErrorAction SilentlyContinue
  $releaseGhToken = $null
}
```

`inspect` 必须在 main SHA 对应的临时 committed worktree 中运行，而不是当前 dirty checkout。

## 6. 创建或复用 dev → main PR

先用 `gh pr list --head dev --base main --state open --json ...` 查找 PR。只允许一个匹配 PR；多个时停止。

不存在时创建：

```text
title: release：合并 dev 至 main（<devSha7>）
base: main
head: dev
label: release-automation
body marker: <!-- codepilotx-manual-beta source=dev sha=<candidateSha> -->
```

存在时验证同源仓库、head/base、当前 head 包含 marker SHA。保留现有标题和正文，只在缺失时追加 marker，并确保存在 `release-automation` 标签。不得覆盖人工正文。

调用 `gh pr merge <number> --auto --merge`。若 GitHub 明确要求更新分支且 PR 可无冲突更新，调用 `gh pr update-branch <number>`；不得使用 `--rebase`。然后用 `gh pr checks <number> --watch --fail-fast` 等待远端 CI，并轮询 `gh pr view` 直到 `mergedAt` 和 `mergeCommit` 均存在。

失败检查使用 `gh run view <run-id> --log-failed` 诊断。代码、测试、a11y、SQLite、性能、依赖或打包失败均为终态代码阻塞：报告后停止，不修改代码。仅网络、GitHub API、runner 排队或无副作用基础设施故障可重试，最多 3 次。

合并后 fetch main，验证：

```powershell
git merge-base --is-ancestor <mergeCommitSha> refs/remotes/origin/main
```

还要验证 PR 的 head SHA 属于 merge commit 历史。closed 但未 merged 不算成功。

## 7. 关联并等待一次 workflow dispatch

每次 dispatch 前记录 UTC 时间和该 workflow 最近 run IDs。只从 `main` ref 触发：

```powershell
gh workflow run prepare-beta-release.yml --ref main -f dry_run=true -f main_sha=<lockedMainSha> -f preflight_digest=<digest> -f preflight_payload=<base64Payload> -f preflight_signature=<base64Signature>
gh workflow run prepare-beta-release.yml --ref main -f dry_run=false -f main_sha=<lockedMainSha> -f preflight_digest=<digest> -f preflight_payload=<base64Payload> -f preflight_signature=<base64Signature> -f dry_run_id=<successfulDryRunId>
gh workflow run finalize-beta-release.yml --ref main -f dry_run=false -f main_sha=<releasePrMergeSha>
```

触发后轮询 `gh run list --workflow <file> --event workflow_dispatch --branch main --json databaseId,displayTitle,headSha,status,conclusion,createdAt,url`。只关联同时满足以下条件的唯一 run：创建时间不早于 dispatch 前记录的 UTC 时间；run ID 不在 dispatch 前记录的集合中；`displayTitle` 中的 dry-run/live 阶段、锁定 SHA、proof digest 与本次输入一致，live 还必须包含 dry-run ID。Prepare 的 `headSha` 必须等于已锁定 main SHA；不一致表示 main 已变化，本次证明和确认立即失效。Finalize 通过 `displayTitle` 关联明确的 Release PR merge SHA，不要求该 SHA 仍为 main tip。不能简单取列表第一项。使用 `gh run watch <id> --exit-status` 等待；失败时读取 `--log-failed`。

如果同 workflow、同锁定 SHA、同 dry-run/live 阶段已有 queued 或 in_progress run，复用并等待。已存在成功 run 时，必须从 `displayTitle` 及日志确认 `main_sha` 和 `dry_run` 输入均相同后才能复用。相同 SHA 的非瞬时失败不得无意义重复 dispatch。

## 8. Dry-run 与唯一确认

dev PR 合并后，在最新 main committed worktree 中执行 `inspect --json`。只允许 `candidate`，并锁定 `mainSha`、`nextVersion`、`nextTag`。在当前维护者 Windows x64 工作站连续执行两次：

```powershell
bun run beta:preflight -- --main-sha <lockedMainSha>
```

两次都必须成功、当前工作区保持干净且 `releaseTreeSha` 相同。使用 `.git/codepilotx/beta-preflight/<mainSha>/workflow-inputs.json` 中的公开 proof inputs dispatch Prepare `dry_run=true`；workflow 会验签、重建相同 tree，并拒绝已经不再等于 `origin/main` tip 的候选。不得输出签名密钥或本机路径。

dry-run 成功后验证唯一回执 artifact 名同时包含 main SHA 和 proof digest，重新执行 inspect，展示锁定版本、main SHA、proof digest、run ID 和 run URL，并请求完全匹配：

```text
发布 <nextTag>
```

任何其他回复都停止。确认前再次读取远端 main；SHA 变化时原确认失效，必须重新 inspect 和 dry-run。

## 9. Live Prepare、Release PR 与 Finalize

确认后用与 dry-run 完全相同的 `mainSha`、proof inputs 和成功 `dry_run_id` dispatch Prepare `dry_run=false`。live 只验证并复用 24 小时内回执，不重新打包。成功后按以下全部条件查找 Release PR：

- label 为 `automation:beta-release`；
- head 为 `automation/release-v<nextVersion>-<mainSha7>`；
- base 为 `main`；
- body 中 base SHA、version 和 tag marker 与锁定值一致；
- 创建者符合 `RELEASE_BOT_LOGIN`。

等待 Release PR 的 required checks 和 auto-merge。不要手工合并失败检查。合并后记录 Release PR merge commit，并将该 SHA 作为 `main_sha` 从 main ref dispatch Finalize `dry_run=false`。手动 Finalize 必须调用现有 `finalize --main-sha <releasePrMergeSha>`；只有自动 schedule 可以调用 `reconcile`，任何流程都不得手工创建 tag。

等待 Finalize、随后由标签触发的 `windows-x64-package.yml` 和 GitHub Release。重复调用恢复模式时，先使用 `inspect --json`；`prepared`、`publishing` 继续 Finalize，`published` 只验证结果，`blocked` 停止并报告。

## 10. 最终验证

对 `<nextTag>` 验证：

1. tag commit 等于 Release PR merge commit。
2. `git merge-base --is-ancestor <tagCommit> origin/main` 成功。
3. `gh release view <nextTag> --json isDraft,isPrerelease,assets,url` 显示非 draft prerelease。
4. 附件名称至少匹配：`*.exe`、`*.blockmap`、`beta.yml`、`SHA256SUMS.txt`、`*.spdx.json`。
5. 不存在同版本仍开放的 `[release automation] <version> 发布阻塞` Issue。

只在五项全部通过后报告发布成功。
