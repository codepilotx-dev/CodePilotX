import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  DesktopGitStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktopClient.js'

export type GitWorkflowMode = 'branch' | 'commitPush' | 'pullRequest'

const EMPTY_CHANGES: DesktopGitStatus['files'] = []

type Props = {
  mode: GitWorkflowMode | null
  workspace: DesktopWorkspace | null
  gitStatus: DesktopGitStatus | null
  gitBranchPrefix: string
  allowForcePush: boolean
  commitMessagePrompt: string
  pullRequestPrompt: string
  onClose: () => void
  onError: (message: string) => void
  onWorkspaceChanged: (workspace: DesktopWorkspace) => Promise<void>
  onRefreshWorkspace: () => Promise<void>
}

export function GitWorkflowModal({
  mode,
  workspace,
  gitStatus,
  gitBranchPrefix,
  allowForcePush,
  commitMessagePrompt,
  pullRequestPrompt,
  onClose,
  onError,
  onWorkspaceChanged,
  onRefreshWorkspace,
}: Props): React.ReactNode {
  const [branchName, setBranchName] = useState(gitBranchPrefix)
  const [commitMessage, setCommitMessage] = useState(commitMessagePrompt)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [setUpstream, setSetUpstream] = useState(false)
  const [forceWithLease, setForceWithLease] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState(pullRequestPrompt)
  const [draftPr, setDraftPr] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const changedFiles = gitStatus?.files ?? EMPTY_CHANGES
  const open = mode !== null
  const title =
    mode === 'branch'
      ? '创建分支'
      : mode === 'pullRequest'
        ? '创建 Pull Request'
        : '提交或推送'

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    setIsSubmitting(false)
    setBranchName(gitBranchPrefix)
    setCommitMessage(commitMessagePrompt)
    setSelectedPaths(changedFiles.map(file => file.path))
    setSetUpstream(!gitStatus?.upstream)
    setForceWithLease(false)
    setPrTitle(gitStatus?.branchName ?? '')
    setPrBody(pullRequestPrompt)
    setDraftPr(true)
  }, [
    changedFiles,
    commitMessagePrompt,
    gitBranchPrefix,
    gitStatus?.branchName,
    gitStatus?.upstream,
    open,
    pullRequestPrompt,
  ])

  const selectedPathSet = useMemo(
    () => new Set(selectedPaths),
    [selectedPaths],
  )

  async function submitBranch(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.createWorkspaceBranch({
        workspacePath: workspace.path,
        branchName,
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await onWorkspaceChanged(result.workspace)
      onClose()
    })
  }

  async function submitCommit(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.commitWorkspaceChanges({
        workspacePath: workspace.path,
        message: commitMessage,
        paths: selectedPaths,
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await onRefreshWorkspace()
      onClose()
    })
  }

  async function submitPush(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.pushWorkspaceBranch({
        workspacePath: workspace.path,
        setUpstream,
        forceWithLease,
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await onRefreshWorkspace()
      onClose()
    })
  }

  async function submitPullRequest(): Promise<void> {
    if (!workspace) return
    await runOperation(async () => {
      const result = await desktopClient.createPullRequest({
        workspacePath: workspace.path,
        title: prTitle,
        body: prBody,
        draft: draftPr,
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await desktopClient.openExternalURL(result.url)
      onClose()
    })
  }

  async function runOperation(operation: () => Promise<void>): Promise<void> {
    setLocalError(null)
    setIsSubmitting(true)
    try {
      await operation()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLocalError(message)
      onError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function togglePath(path: string): void {
    setSelectedPaths(current =>
      current.includes(path)
        ? current.filter(item => item !== path)
        : [...current, path],
    )
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) onClose()
      }}
    >
      <Dialog.Portal>
        {open ? (
          <Dialog.Overlay className="permission-modal-backdrop">
            <Dialog.Content
              aria-describedby="git-workflow-description"
              className="permission-modal git-workflow-modal"
            >
              <header>
                <Dialog.Title asChild>
                  <h2>{title}</h2>
                </Dialog.Title>
                <span>{workspace?.name ?? '无项目'}</span>
              </header>
              <Dialog.Description id="git-workflow-description">
                {workspace?.path ?? '请选择一个本地项目后再操作 Git。'}
              </Dialog.Description>
              {localError ? (
                <div className="git-workflow-error">{localError}</div>
              ) : null}
              {mode === 'branch' ? (
                <div className="git-workflow-form">
                  <label>
                    <span>分支名称</span>
                    <input
                      value={branchName}
                      onChange={event => setBranchName(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              {mode === 'commitPush' ? (
                <div className="git-workflow-form">
                  <label>
                    <span>提交信息</span>
                    <textarea
                      value={commitMessage}
                      onChange={event => setCommitMessage(event.target.value)}
                    />
                  </label>
                  <div className="git-workflow-files-scroll-area">
                    <div className="git-workflow-files-scroll-content">
                      <div>
                        <strong>变更文件</strong>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPaths(changedFiles.map(file => file.path))
                          }
                        >
                          全选
                        </button>
                      </div>
                      {changedFiles.length === 0 ? (
                        <p>当前没有可提交的文件。</p>
                      ) : (
                        changedFiles.map(file => (
                          <label key={`${file.status}:${file.path}`}>
                            <input
                              checked={selectedPathSet.has(file.path)}
                              type="checkbox"
                              onChange={() => togglePath(file.path)}
                            />
                            <span title={file.path}>{file.path}</span>
                            <small>{file.status.trim() || 'M'}</small>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <label className="git-workflow-check">
                    <input
                      checked={setUpstream}
                      type="checkbox"
                      onChange={event => setSetUpstream(event.target.checked)}
                    />
                    <span>首次推送时设置 upstream</span>
                  </label>
                  {allowForcePush ? (
                    <label className="git-workflow-check">
                      <input
                        checked={forceWithLease}
                        type="checkbox"
                        onChange={event =>
                          setForceWithLease(event.target.checked)
                        }
                      />
                      <span>使用 --force-with-lease</span>
                    </label>
                  ) : null}
                </div>
              ) : null}
              {mode === 'pullRequest' ? (
                <div className="git-workflow-form">
                  <label>
                    <span>标题</span>
                    <input
                      value={prTitle}
                      onChange={event => setPrTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>描述</span>
                    <textarea
                      value={prBody}
                      onChange={event => setPrBody(event.target.value)}
                    />
                  </label>
                  <label className="git-workflow-check">
                    <input
                      checked={draftPr}
                      type="checkbox"
                      onChange={event => setDraftPr(event.target.checked)}
                    />
                    <span>创建为 draft PR</span>
                  </label>
                </div>
              ) : null}
              <div className="permission-modal-actions">
                <button type="button" onClick={onClose}>
                  取消
                </button>
                {mode === 'commitPush' ? (
                  <>
                    <button
                      disabled={isSubmitting || changedFiles.length === 0}
                      type="button"
                      onClick={() => void submitCommit()}
                    >
                      提交选中文件
                    </button>
                    <button
                      className="primary-button"
                      disabled={isSubmitting}
                      type="button"
                      onClick={() => void submitPush()}
                    >
                      推送
                    </button>
                  </>
                ) : (
                  <button
                    className="primary-button"
                    disabled={isSubmitting}
                    type="button"
                    onClick={() =>
                      void (mode === 'branch'
                        ? submitBranch()
                        : submitPullRequest())
                    }
                  >
                    {mode === 'branch' ? '创建并检出' : '创建 PR'}
                  </button>
                )}
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
