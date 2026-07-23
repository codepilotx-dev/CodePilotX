import { desktopClient } from '../../services/desktop-client/index.js'
import type { DesktopGitStatus } from '../../../shared/types.js'
import { normalizeOptionalText } from '../settings/settingsStorage.js'

export type ReviewActionInput = {
  sessionId: string | null
  gitStatus: DesktopGitStatus | null
  diff: string
  model: string
}

const MAX_DIFF_CHARS = 12_000

export async function submitReviewAction(
  input: ReviewActionInput,
): Promise<boolean> {
  if (!input.sessionId) {
    return false
  }
  const files = input.gitStatus?.files ?? []
  const additions = countDiffLines(input.diff, '+')
  const deletions = countDiffLines(input.diff, '-')
  const trimmedDiff =
    input.diff.length > MAX_DIFF_CHARS
      ? `${input.diff.slice(0, MAX_DIFF_CHARS)}\n... (diff 已截断，共 ${input.diff.length} 字符)`
      : input.diff
  const fileList =
    files.length > 0
      ? files
          .slice(0, 50)
          .map((f) => `\`${f.path}\` (${describeStatus(f.status, f.isUntracked)})`)
          .join('\n')
      : '（git status 无文件）'
  const text = [
    '请对以下变更执行一次代码审查（/review）。',
    '工作流：先用工具读取完整 diff，针对每个文件给出发现，',
    '最后给出一份按严重程度（高/中/低）分组的总结。',
    '',
    '## 变更文件',
    fileList,
    '',
    '## 统计',
    `- 新增 ${additions} 行`,
    `- 删除 ${deletions} 行`,
    `- 文件数 ${files.length}`,
    '',
    '## Diff 片段',
    '```diff',
    trimmedDiff || '（无可用 diff）',
    '```',
  ].join('\n')
  try {
    await desktopClient.sendUserMessage(
      input.sessionId,
      { text, attachments: [] },
      normalizeOptionalText(input.model),
    )
    return true
  } catch {
    return false
  }
}

function countDiffLines(diff: string, marker: '+' | '-'): number {
  let count = 0
  for (const line of diff.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line[0] === marker) count += 1
  }
  return count
}

function describeStatus(status: string, isUntracked: boolean): string {
  if (isUntracked) return '未跟踪'
  const code = status.trim().slice(0, 2)
  switch (code[0]) {
    case 'M':
      return '已修改'
    case 'A':
      return '新增'
    case 'D':
      return '已删除'
    case 'R':
      return '重命名'
    case 'C':
      return '复制'
    case '?':
      return '未跟踪'
    default:
      return status.trim() || '已修改'
  }
}
