import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { DesktopGitOperationResult } from '../shared/types.js'
import { assertAllowedWorkspace, getWorkspaceGitStatus } from './workspaceService.js'

const execFileAsync = promisify(execFile)

export type TurnRestoreBaseline = {
  files: Record<string, TurnRestoreFileBaseline>
}

export type TurnRestoreFileBaseline =
  | { existed: true; content: string }
  | { existed: false }

export async function captureTurnRestoreBaseline(
  workspacePath: string,
): Promise<TurnRestoreBaseline> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  const status = await getWorkspaceGitStatus(resolvedWorkspace)
  if (!status.ok) {
    throw new Error('Unable to read workspace git status.')
  }
  const files: Record<string, TurnRestoreFileBaseline> = {}
  await Promise.all(
    status.status.files.map(async file => {
      const absolutePath = resolve(resolvedWorkspace, file.path)
      try {
        files[file.path] = {
          existed: true,
          content: await readFile(absolutePath, 'utf8'),
        }
      } catch {
        files[file.path] = { existed: false }
      }
    }),
  )
  return { files }
}

export async function restoreTurnBaselineChanges(input: {
  workspacePath: string
  baseline: TurnRestoreBaseline
  paths: string[]
}): Promise<DesktopGitOperationResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
    const paths = validateRestorePaths(resolvedWorkspace, input.baseline, input.paths)
    const output: string[] = []
    const baselinePaths: string[] = []
    const cleanPaths: string[] = []

    for (const path of paths) {
      const baseline = input.baseline.files[path]
      if (baseline) {
        baselinePaths.push(path)
        const absolutePath = resolve(resolvedWorkspace, path)
        if (baseline.existed) {
          await mkdir(dirname(absolutePath), { recursive: true })
          await writeFile(absolutePath, baseline.content, 'utf8')
        } else {
          await rm(absolutePath, { force: true, recursive: true })
        }
      } else {
        cleanPaths.push(path)
      }
    }

    if (cleanPaths.length > 0) {
      const trackedPaths = await filterTrackedPaths(resolvedWorkspace, cleanPaths)
      if (trackedPaths.length > 0) {
        await execFileAsync('git', [
          '-C',
          resolvedWorkspace,
          'checkout',
          '--',
          ...trackedPaths,
        ])
      }
      const untrackedPaths = cleanPaths.filter(path => !trackedPaths.includes(path))
      if (untrackedPaths.length > 0) {
        await execFileAsync('git', [
          '-C',
          resolvedWorkspace,
          'clean',
          '-f',
          '--',
          ...untrackedPaths,
        ])
      }
    }

    output.push(
      baselinePaths.length > 0
        ? `[restore baseline] ${baselinePaths.join(', ')}`
        : '[restore baseline] none',
    )
    if (cleanPaths.length > 0) {
      output.push(`[restore clean] ${cleanPaths.join(', ')}`)
    }
    const status = await getWorkspaceGitStatus(resolvedWorkspace)
    if (!status.ok) return status
    return { ok: true, output: output.join('\n'), status: status.status }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function validateRestorePaths(
  workspacePath: string,
  baseline: TurnRestoreBaseline,
  paths: string[],
): string[] {
  const uniquePaths = [...new Set(paths.map(path => path.trim()).filter(Boolean))]
  if (uniquePaths.length === 0) {
    throw new Error('Select at least one changed file to restore.')
  }
  for (const path of uniquePaths) {
    if (path.startsWith('-')) {
      throw new Error(`Refusing to use an unsafe Git path: ${path}`)
    }
    const resolvedPath = resolve(workspacePath, path)
    const workspacePrefix = workspacePath.endsWith('\\')
      ? workspacePath
      : `${workspacePath}\\`
    if (resolvedPath !== workspacePath && !resolvedPath.startsWith(workspacePrefix)) {
      throw new Error(`Path is outside the workspace: ${path}`)
    }
    if (baseline.files[path] === undefined) continue
  }
  return uniquePaths
}

export type FileState =
  | { existed: true; content: Buffer }
  | { existed: false }

export type StoredTurnRestore = {
  workspacePath: string
  before: Record<string, FileState>
  after: Record<string, FileState>
  paths: string[]
}

/**
 * Capture the current state of files at given paths.
 * Returns a map of path → FileState.
 */
export async function capturePathStates(
  workspacePath: string,
  paths: string[],
): Promise<Record<string, FileState>> {
  const states: Record<string, FileState> = {}
  await Promise.all(
    paths.map(async path => {
      const absolutePath = resolve(workspacePath, path)
      try {
        await stat(absolutePath)
        states[path] = {
          existed: true,
          content: await readFile(absolutePath),
        }
      } catch {
        states[path] = { existed: false }
      }
    }),
  )
  return states
}

/**
 * Preflight check for restoring a chain of turn states.
 * Returns the target state to apply, or a conflict error.
 */
export function preflightTurnRestoreChain(
  entries: StoredTurnRestore[],
  current: Record<string, FileState>,
): { ok: true; target: Record<string, FileState> }
 | { ok: false; error: string; conflicts: string[] } {
  if (entries.length === 0) {
    return { ok: false, error: 'No restore entries to apply.', conflicts: [] }
  }

  const conflicts: string[] = []

  // Check each file against the latest "after" state
  for (const [path, currentState] of Object.entries(current)) {
    // Find the last entry that references this path
    for (let i = entries.length - 1; i >= 0; i--) {
      const afterState = entries[i].after[path]
      if (afterState !== undefined) {
        // Compare current state with after state
        const currentExisted = currentState.existed
        const afterExisted = afterState.existed
        if (currentExisted !== afterExisted) {
          conflicts.push(path)
        } else if (currentExisted && afterExisted) {
          const currentBuffer = currentState.content
          const afterBuffer = afterState.content
          if (!currentBuffer.equals(afterBuffer)) {
            conflicts.push(path)
          }
        }
        break
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      error: `File conflict(s) detected: ${conflicts.join(', ')}. Current state differs from expected after-rollback state.`,
      conflicts,
    }
  }

  // Target is the "before" state of the first entry in the chain
  const target: Record<string, FileState> = {}
  for (const entry of entries) {
    for (const [path, state] of Object.entries(entry.before)) {
      if (target[path] === undefined) {
        target[path] = state
      }
    }
  }

  return { ok: true, target }
}

/**
 * Apply a set of file states to the workspace.
 * Creates missing parent directories as needed.
 */
export async function applyPathStates(
  workspacePath: string,
  states: Record<string, FileState>,
): Promise<void> {
  await Promise.all(
    Object.entries(states).map(async ([path, state]) => {
      const absolutePath = resolve(workspacePath, path)
      if (state.existed) {
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(absolutePath, state.content)
      } else {
        await rm(absolutePath, { force: true, recursive: true })
      }
    }),
  )
}

/**
 * Get the union of all restore paths across multiple entries.
 */
export function unionRestorePaths(entries: StoredTurnRestore[]): string[] {
  const pathSet = new Set<string>()
  for (const entry of entries) {
    for (const path of entry.paths) {
      pathSet.add(path)
    }
  }
  return [...pathSet]
}

async function filterTrackedPaths(
  workspacePath: string,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) return []
  const { stdout } = await execFileAsync('git', [
    '-C',
    workspacePath,
    'ls-files',
    '-z',
    '--',
    ...paths,
  ]).catch(() => ({ stdout: '' }))
  const tracked = new Set(
    stdout
      .split('\0')
      .map(line => line.trim())
      .filter(Boolean),
  )
  return paths.filter(path => tracked.has(path))
}
