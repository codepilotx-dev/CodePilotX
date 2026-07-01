import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
