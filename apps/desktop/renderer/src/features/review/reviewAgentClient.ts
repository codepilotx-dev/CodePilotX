import type {
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewSource,
} from '../../../shared/types.js'
import { AgentRpcError } from '../../services/agentRpcClient.js'
import {
  desktopClient,
  type DesktopReviewAgentComment,
} from '../../services/desktopClient.js'

export type ReviewFileSummary = {
  path: string
  previousPath: string | null
  status:
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'untracked'
    | 'type-changed'
    | 'unknown'
  additions: number | null
  deletions: number | null
  changedLines: number
  changedBytes: number
  binary: boolean
  revision: string
}

export type ReviewSummarySnapshot = {
  projectId: string
  generation: string
  source: DesktopReviewSource
  repositoryRoot: string
  headSha: string | null
  baseSha: string | null
  files: ReviewFileSummary[]
  totals: {
    files: number
    additions: number
    deletions: number
    changedLines: number
    changedBytes: number
  }
  largeDiffMode: boolean
}

export type ReviewFileDiff = {
  file: ReviewFileSummary
  revision: string
  patch: string
  hunks: Array<{
    id: string
    header: string
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patch: string
  }>
  renderable: boolean
  tooLargeReason: 'changed-lines' | 'changed-bytes' | 'line-bytes' | null
}

export type ReviewBranch = {
  name: string
  sha: string
  current: boolean
  remote: boolean
}

export type ReviewCommit = {
  sha: string
  shortSha: string
  subject: string
  author: string
  authoredAt: string
}

export type ReviewLoadState =
  | 'loading'
  | 'success'
  | 'empty'
  | 'not-repository'
  | 'large-diff'
  | 'stale'
  | 'unsupported'
  | 'error'

export const reviewAgentClient = {
  async summary(
    workspacePath: string,
    source: DesktopReviewSource,
    refresh = false,
  ): Promise<ReviewSummarySnapshot> {
    return desktopClient.getAgentReviewSummary({
      workspacePath,
      source,
      refresh,
    })
  },

  async fileDiff(
    workspacePath: string,
    source: DesktopReviewSource,
    generation: string,
    path: string,
    hideWhitespace: boolean,
  ): Promise<ReviewFileDiff> {
    return desktopClient.getAgentReviewFileDiff({
      workspacePath,
      source,
      generation,
      path,
      hideWhitespace,
    })
  },

  async apply(
    workspacePath: string,
    input: {
      source: DesktopReviewSource
      generation: string
      expectedRevision: string
      action: 'stage' | 'unstage' | 'revert'
      target:
        | { kind: 'file'; path: string }
        | { kind: 'hunk'; path: string; hunkId: string }
    },
  ): Promise<void> {
    await desktopClient.applyAgentReviewOperation({
      workspacePath,
      source: input.source,
      generation: input.generation,
      expectedRevision: input.expectedRevision,
      action: input.action,
      target: input.target,
    })
  },

  async branches(workspacePath: string): Promise<ReviewBranch[]> {
    return desktopClient.getAgentReviewBranches(workspacePath)
  },

  async commits(workspacePath: string): Promise<ReviewCommit[]> {
    return desktopClient.getAgentReviewCommits(workspacePath)
  },

  async listComments(
    workspacePath: string,
    threadId: string,
    source: DesktopReviewSource,
  ): Promise<DesktopReviewComment[]> {
    const sourceKey = reviewSourceKey(source)
    const comments = await desktopClient.listAgentReviewComments({
      workspacePath,
      threadId,
      sourceKey,
    })
    return comments.map(toDesktopComment)
  },

  async saveComment(
    workspacePath: string,
    threadId: string,
    source: DesktopReviewSource,
    revision: string,
    input: {
      filePath: string
      side: 'left' | 'right'
      lineNumber: number
      body: string
      hunkId?: string | null
    },
  ): Promise<DesktopReviewComment> {
    const comment = await desktopClient.saveAgentReviewComment({
        workspacePath,
        threadId,
        sourceKey: reviewSourceKey(source),
        path: input.filePath,
        side: input.side === 'left' ? 'old' : 'new',
        line: input.lineNumber,
        hunkId: input.hunkId ?? null,
        revision,
        body: input.body,
      })
    return toDesktopComment(comment)
  },

  async resolveComment(
    workspacePath: string,
    threadId: string,
    id: string,
  ): Promise<DesktopReviewComment> {
    return toDesktopComment(
      await desktopClient.resolveAgentReviewComment({
        workspacePath,
        threadId,
        id,
      }),
    )
  },

  async deleteComment(
    workspacePath: string,
    threadId: string,
    id: string,
  ): Promise<void> {
    await desktopClient.deleteAgentReviewComment({
      workspacePath,
      threadId,
      id,
    })
  },

  async publishGithubComment(
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>,
    input: {
      body: string
      path: string
      side: 'left' | 'right'
      line: number
      expectedHeadRevision: string
      commitId?: string
    },
  ): Promise<{ id: number; nodeId: string; htmlUrl: string }> {
    return desktopClient.publishAgentGithubReviewComment({
      source,
      body: input.body,
      path: input.path,
      side: input.side === 'left' ? 'LEFT' : 'RIGHT',
      line: input.line,
      expectedHeadRevision: input.expectedHeadRevision,
      ...(input.commitId ? { commitId: input.commitId } : {}),
    })
  },

  async linkGithubComment(
    workspacePath: string,
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>,
    comment: DesktopReviewComment,
    github: { id: number },
  ): Promise<DesktopReviewComment> {
    if (!comment.revision) {
      throw new Error('本地评论缺少 revision，无法建立 GitHub 映射')
    }
    return toDesktopComment(
      await desktopClient.saveAgentReviewComment({
        id: comment.id,
        workspacePath,
        threadId: comment.sessionId,
        sourceKey: reviewSourceKey(source),
        path: comment.filePath,
        side: comment.side === 'left' ? 'old' : 'new',
        line: comment.lineNumber,
        hunkId: comment.hunkId ?? null,
        revision: comment.revision,
        body: comment.body,
        githubCommentId: String(github.id),
      }),
    )
  },

  async submitGithubReview(
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>,
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
    expectedHeadRevision: string,
    body?: string,
  ): Promise<{ id: number; state: string; htmlUrl: string }> {
    return desktopClient.submitAgentGithubReview({
      source,
      event,
      expectedHeadRevision,
      ...(body ? { body } : {}),
    })
  },

  isSnapshotExpired(error: unknown): boolean {
    return (
      error instanceof AgentRpcError &&
      error.errorCode === 'REVIEW_SNAPSHOT_EXPIRED'
    )
  },
}

export function reviewSourceKey(source: DesktopReviewSource): string {
  switch (source.kind) {
    case 'unstaged':
    case 'staged':
      return source.kind
    case 'branch':
      return `branch:${source.baseBranch}`
    case 'commit':
      return `commit:${source.commitSha}`
    case 'last-turn':
      return `last-turn:${source.threadId}:${source.turnId}`
    case 'pull-request':
      return `pull-request:${source.owner}/${source.repository}#${source.number}`
  }
}

export function reviewSourceLabel(source: DesktopReviewSource): string {
  switch (source.kind) {
    case 'unstaged':
      return '未暂存'
    case 'staged':
      return '已暂存'
    case 'branch':
      return `分支 · ${source.baseBranch}`
    case 'commit':
      return `提交 · ${source.commitSha.slice(0, 8)}`
    case 'last-turn':
      return '上轮对话'
    case 'pull-request':
      return `PR #${source.number}`
  }
}

export function reviewLoadStateForError(error: unknown): ReviewLoadState {
  if (error instanceof AgentRpcError) {
    if (error.errorCode === 'REPOSITORY_NOT_FOUND') return 'not-repository'
    if (error.errorCode === 'REVIEW_SNAPSHOT_EXPIRED') return 'stale'
    if (error.errorCode === 'CAPABILITY_REQUIRED') return 'unsupported'
  }
  if (
    error instanceof Error &&
    (error.message.includes('AGENT_OPERATION_UNSUPPORTED') ||
      error.message.includes('Agent 版本过旧'))
  ) {
    return 'unsupported'
  }
  return 'error'
}

export function summaryFileToDesktop(
  file: ReviewFileSummary,
  loaded?: ReviewFileDiff,
): DesktopReviewDiffFile {
  return {
    path: file.path,
    ...(file.previousPath ? { originalPath: file.previousPath } : {}),
    status: file.status,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    isUntracked: file.status === 'untracked',
    hunks: loaded ? parseReviewFileDiff(loaded) : [],
    revision: loaded?.revision ?? file.revision,
    renderable: loaded?.renderable,
    tooLargeReason: loaded?.tooLargeReason,
  }
}

function parseReviewFileDiff(diff: ReviewFileDiff): DesktopReviewDiffHunk[] {
  if (!diff.renderable) return []
  const parsedByHeader = parsePatchLines(diff.patch)
  return diff.hunks.map((hunk, index) => {
    const parsed = parsedByHeader[index]
    return {
      id: hunk.id,
      header: hunk.header,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      patch: hunk.patch,
      lines: parsed?.lines ?? [],
    }
  })
}

function parsePatchLines(
  patch: string,
): Array<{ header: string; lines: DesktopReviewDiffLine[] }> {
  const result: Array<{ header: string; lines: DesktopReviewDiffLine[] }> = []
  let current: { header: string; lines: DesktopReviewDiffLine[] } | null = null
  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split(/\r?\n/u)) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw)
    if (match) {
      oldLine = Number(match[1])
      newLine = Number(match[2])
      current = { header: raw, lines: [] }
      result.push(current)
      continue
    }
    if (!current || raw.startsWith('\\ No newline')) continue
    const prefix = raw[0]
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') continue
    const type =
      prefix === '+' ? 'added' : prefix === '-' ? 'removed' : 'context'
    const line: DesktopReviewDiffLine = {
      id: `${result.length}:${current.lines.length}`,
      type,
      oldLine: prefix === '+' ? null : oldLine,
      newLine: prefix === '-' ? null : newLine,
      content: raw.slice(1),
      raw,
    }
    current.lines.push(line)
    if (prefix !== '+') oldLine += 1
    if (prefix !== '-') newLine += 1
  }
  return result
}

function toDesktopComment(comment: DesktopReviewAgentComment): DesktopReviewComment {
  return {
    id: comment.id,
    sessionId: comment.threadId,
    filePath: comment.path,
    side: comment.side === 'old' ? 'left' : 'right',
    lineNumber: comment.line,
    lineContent: '',
    body: comment.body,
    status: comment.status,
    revision: comment.revision,
    hunkId: comment.hunkId,
    githubCommentId: comment.githubCommentId,
    githubThreadId: comment.githubThreadId,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  }
}
