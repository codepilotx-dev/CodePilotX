export function shouldEmitWorkspaceDiffEvent(params: {
  beforePatch?: string | null
  afterPatch: string
  standalone: boolean
}): boolean {
  if (params.standalone) {
    return false
  }
  if (params.afterPatch === 'No file changes.') {
    return false
  }
  if (params.beforePatch !== undefined && params.beforePatch !== null) {
    return params.beforePatch !== params.afterPatch
  }
  return false
}

export type TurnDiffFile = {
  path: string
  additions: number
  deletions: number
}

export function buildTurnDiffPatch(params: {
  beforePatch?: string | null
  afterPatch: string
}): string {
  return buildTurnDiff(params).patch
}

export function buildTurnDiff(params: {
  beforePatch?: string | null
  afterPatch: string
}): { patch: string; files: TurnDiffFile[] } {
  const after = parseWorkspacePatch(params.afterPatch)
  if (params.beforePatch === undefined || params.beforePatch === null) {
    return {
      patch: params.afterPatch,
      files: [...after.files.values()].map(file => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
      })),
    }
  }

  const before = parseWorkspacePatch(params.beforePatch)
  const changedPaths = new Set<string>()
  for (const [path, afterFile] of after.files) {
    const beforeFile = before.files.get(path)
    if (!beforeFile || beforeFile.fingerprint !== afterFile.fingerprint) {
      changedPaths.add(path)
    }
  }
  for (const path of before.files.keys()) {
    if (!after.files.has(path)) {
      changedPaths.add(path)
    }
  }

  const files = [...changedPaths]
    .map(path => after.files.get(path) ?? before.files.get(path))
    .filter((file): file is ParsedPatchFile => Boolean(file))
    .map(file => ({
      path: file.path,
      additions: after.files.get(file.path)?.additions ?? 0,
      deletions: after.files.get(file.path)?.deletions ?? 0,
    }))

  const statusLines = after.statusLines.filter(line => {
    const path = parseStatusPath(line)
    return path ? changedPaths.has(path) : false
  })
  for (const path of changedPaths) {
    if (!after.files.has(path) && before.files.has(path)) {
      statusLines.push(`  ${path}`)
    }
  }
  const chunks = [...changedPaths]
    .map(path => after.files.get(path)?.chunk)
    .filter((chunk): chunk is string => Boolean(chunk))

  const sections = [
    statusLines.length > 0 ? `Git status:\n${statusLines.join('\n')}` : null,
    chunks.length > 0
      ? `Diff:\n${chunks.join('\n').replace(/\n?$/, '\n')}`
      : statusLines.length > 0
        ? 'Diff:\nNo tracked file diff.'
        : null,
  ].filter((section): section is string => Boolean(section))

  return {
    patch: sections.length > 0 ? sections.join('\n\n') : 'No file changes.',
    files,
  }
}

type ParsedPatchFile = {
  path: string
  chunk: string
  fingerprint: string
  additions: number
  deletions: number
}

function parseWorkspacePatch(patch: string): {
  statusLines: string[]
  files: Map<string, ParsedPatchFile>
} {
  const statusLines: string[] = []
  const files = new Map<string, ParsedPatchFile>()
  const lines = patch.split(/\r?\n/)
  let inStatus = false
  let inDiff = false
  let current: { path: string; lines: string[]; additions: number; deletions: number } | null =
    null

  function finishCurrent(): void {
    if (!current) return
    const chunk = current.lines.join('\n').trimEnd()
    files.set(current.path, {
      path: current.path,
      chunk,
      fingerprint: chunk,
      additions: current.additions,
      deletions: current.deletions,
    })
    current = null
  }

  for (const line of lines) {
    if (line === 'Git status:') {
      finishCurrent()
      inStatus = true
      inDiff = false
      continue
    }
    if (line === 'Diff:') {
      inStatus = false
      inDiff = true
      continue
    }
    if (inStatus) {
      if (line.trim()) statusLines.push(line)
      continue
    }
    if (!inDiff) continue
    if (line.startsWith('diff --git ')) {
      finishCurrent()
      current = { path: parseDiffPath(line), lines: [line], additions: 0, deletions: 0 }
      continue
    }
    if (!current) continue
    current.lines.push(line)
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
    if (line.startsWith('+')) current.additions += 1
    if (line.startsWith('-')) current.deletions += 1
  }
  finishCurrent()

  for (const statusLine of statusLines) {
    const path = parseStatusPath(statusLine)
    if (!path || files.has(path)) continue
    files.set(path, {
      path,
      chunk: '',
      fingerprint: statusLine,
      additions: 0,
      deletions: 0,
    })
  }

  return { statusLines, files }
}

function parseStatusPath(line: string): string | null {
  const rawPath = line.slice(3).trim()
  if (!rawPath) return null
  const renameParts = rawPath.split(' -> ')
  return renameParts.at(-1)?.trim() || rawPath
}

function parseDiffPath(line: string): string {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
  return match?.[2] ?? line.replace(/^diff --git\s+/, '').trim()
}
