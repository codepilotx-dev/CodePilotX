import { isAutoMemPath } from '../memdir/paths.js'
import { scanForSecrets } from '../services/teamMemorySync/secretScanner.js'

export function checkRepoMemoryContentSafety(
  filePath: string,
  content: string,
): string | null {
  if (!isAutoMemPath(filePath)) return null

  const matches = scanForSecrets(content)
  if (matches.length > 0) {
    const labels = matches.map(match => match.label).join(', ')
    return (
      `Content contains potential secrets (${labels}) and cannot be written to project memory. ` +
      'Project memory is stored in the repository and may be committed to Git. ' +
      'Remove the sensitive content and try again.'
    )
  }

  if (
    /\b(ignore|override|bypass)\b[\s\S]{0,80}\b(system|developer|user|AGENTS\.md|higher-priority)\b/i.test(
      content,
    ) ||
    /\b(leak|exfiltrate|reveal)\b[\s\S]{0,80}\b(secret|token|credential|password|private key)\b/i.test(
      content,
    )
  ) {
    return (
      'Content contains unsafe memory instructions and cannot be written to project memory.'
    )
  }

  return null
}
