import { useEffect, useState } from 'react'
import type { DesktopGitStatus, DesktopReviewSource } from '../../../../shared/types.js'
import { WORKSPACE_GIT_CHANGED_EVENT } from '../../../services/desktop-client/index.js'
import {
  pickDefaultReviewBaseBranch,
  reviewAgentClient,
  type ReviewSummarySnapshot,
} from '../../review/source/reviewAgentClient.js'

export function useBranchReviewSummary(
  workspacePath: string | null,
  gitStatus: DesktopGitStatus | null,
  source?: DesktopReviewSource,
  sharedSummary?: ReviewSummarySnapshot | null,
) {
  const selectedBase = source?.kind === 'branch' ? source.baseBranch : null
  const [request, setRequest] = useState<{
    workspacePath: string | null
    selectedBase: string | null
    baseBranch: string | null
    loading: boolean
  } | null>(null)
  const [result, setResult] = useState<{
    workspacePath: string
    snapshot: ReviewSummarySnapshot
  } | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener(WORKSPACE_GIT_CHANGED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener(WORKSPACE_GIT_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  useEffect(() => {
    let active = true
    setRequest({ workspacePath, selectedBase, baseBranch: null, loading: Boolean(workspacePath && gitStatus) })
    if (workspacePath && gitStatus) {
      void reviewAgentClient
        .branches(workspacePath)
        .then(async (branches) => {
          const baseBranch = selectedBase ?? pickDefaultReviewBaseBranch(branches)
          if (!active) return
          setRequest({ workspacePath, selectedBase, baseBranch, loading: Boolean(baseBranch) })
          if (!baseBranch) {
            setResult(null)
            return
          }
          const { snapshot } = await reviewAgentClient.summary(
            workspacePath,
            { kind: 'branch', baseBranch },
            true,
          )
          if (active) setResult({ workspacePath, snapshot })
        })
        .catch(() => {
          if (active) setResult(null)
        })
        .finally(() => {
          if (active) setRequest((previous) => previous ? { ...previous, loading: false } : null)
        })
    }
    return () => {
      active = false
    }
  }, [workspacePath, gitStatus, revision, selectedBase])
  const shared = sharedSummary?.source.kind === 'branch' && sharedSummary.source.baseBranch === selectedBase
    ? sharedSummary : null
  const snapshot = shared ?? (result?.workspacePath === workspacePath &&
    (!selectedBase ||
      (result.snapshot.source.kind === 'branch' &&
        result.snapshot.source.baseBranch === selectedBase))
    ? result.snapshot
    : null)
  const currentRequest = request?.workspacePath === workspacePath && request.selectedBase === selectedBase
    ? request : null
  const baseBranch = selectedBase ?? currentRequest?.baseBranch ??
    (snapshot?.source.kind === 'branch' ? snapshot.source.baseBranch : null) ??
    gitStatus?.upstream ?? gitStatus?.branchName ?? 'HEAD'
  return {
    snapshot: currentRequest?.baseBranch && snapshot?.source.kind === 'branch' &&
      snapshot.source.baseBranch !== currentRequest.baseBranch ? null : snapshot,
    loading: !shared && Boolean(workspacePath && gitStatus) && (currentRequest?.loading ?? true),
    source: { kind: 'branch', baseBranch } as const,
  }
}
