import { app, dialog, shell, type BrowserWindow } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import {
  getStandaloneWorkspaceMetadata,
  getStandaloneWorkspacePath,
} from './standaloneWorkspace.js'
import type {
  CommitChangesInput,
  CreateBranchInput,
  CreatePullRequestInput,
  DiscardWorkspaceChangesInput,
  DesktopDiffSummary,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitFileChange,
  DesktopGitOperationResult,
  DesktopGitStatus,
  DesktopGitStatusResult,
  DesktopGitWorkspaceResult,
  DesktopOpenTarget,
  DesktopPullRequestResult,
  DesktopReviewDiffFile,
  DesktopReviewDiffInput,
  DesktopReviewDiffLine,
  DesktopReviewDiffResult,
  DesktopReviewOperationInput,
  DesktopReviewOperationResult,
  DesktopReviewScope,
  PushBranchInput,
  DesktopWorkspace,
} from '../shared/types.js'
import {
  assertAllowedWorkspace,
  assertPathInsideAllowedWorkspace,
  normalizeWorkspacePath,
  registerAllowedWorkspace,
} from './workspacePathGuard.js'

export {
  assertAllowedWorkspace,
  normalizeWorkspacePath,
  registerAllowedWorkspace,
  registerAllowedWorkspaces,
} from './workspacePathGuard.js'

const execFileAsync = promisify(execFile)
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.cache',
  '.Temp',
  'node_modules',
  'dist',
  'bun_cache',
  'release',
])
const MAX_FILE_PREVIEW_BYTES = 200_000
const DEFAULT_OPEN_TARGET: DesktopOpenTarget = {
  id: 'default-app',
  label: 'Default app',
  kind: 'default-app',
}
const BUILTIN_OPEN_TARGETS: DesktopOpenTarget[] = [
  DEFAULT_OPEN_TARGET,
  { id: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
  { id: 'terminal', label: 'Terminal', kind: 'terminal' },
]
const JETBRAINS_WINDOWS_PRODUCTS = [
  { label: 'IntelliJ IDEA', matches: ['intellij'], executables: ['idea64.exe', 'idea.exe'] },
  { label: 'PyCharm', matches: ['pycharm'], executables: ['pycharm64.exe', 'pycharm.exe'] },
  { label: 'WebStorm', matches: ['webstorm'], executables: ['webstorm64.exe', 'webstorm.exe'] },
  { label: 'PhpStorm', matches: ['phpstorm'], executables: ['phpstorm64.exe', 'phpstorm.exe'] },
  { label: 'RubyMine', matches: ['rubymine'], executables: ['rubymine64.exe', 'rubymine.exe'] },
  { label: 'CLion', matches: ['clion'], executables: ['clion64.exe', 'clion.exe'] },
  { label: 'GoLand', matches: ['goland'], executables: ['goland64.exe', 'goland.exe'] },
  { label: 'Rider', matches: ['rider'], executables: ['rider64.exe', 'rider.exe'] },
  { label: 'DataGrip', matches: ['datagrip'], executables: ['datagrip64.exe', 'datagrip.exe'] },
  { label: 'DataSpell', matches: ['dataspell'], executables: ['dataspell64.exe', 'dataspell.exe'] },
]

let getDialogWindow: () => BrowserWindow | null = () => null

export function configureWorkspaceService(options: {
  getWindow: () => BrowserWindow | null
}): void {
  getDialogWindow = options.getWindow
}

export async function chooseWorkspace(): Promise<DesktopWorkspace | null> {
  const result = await dialog.showOpenDialog(getDialogWindow() ?? undefined, {
    title: 'Choose workspace',
    properties: ['openDirectory'],
  })
  const selected = result.filePaths[0]
  if (result.canceled || !selected) {
    return null
  }
  return openWorkspaceFromSelection(selected)
}

export async function openWorkspace(workspacePath: string): Promise<DesktopWorkspace> {
  return openWorkspaceInternal(assertAllowedWorkspace(workspacePath))
}

async function openWorkspaceFromSelection(
  workspacePath: string,
): Promise<DesktopWorkspace> {
  return openWorkspaceInternal(workspacePath)
}

async function openWorkspaceInternal(
  workspacePath: string,
): Promise<DesktopWorkspace> {
  const resolvedWorkspace = resolve(workspacePath)
  const workspaceStat = await stat(resolvedWorkspace)
  if (!workspaceStat.isDirectory()) {
    throw new Error('Workspace path must be a directory.')
  }
  registerAllowedWorkspace(resolvedWorkspace)
  return workspaceFromPath(resolvedWorkspace)
}

export async function listOpenTargets(): Promise<DesktopOpenTarget[]> {
  const detectedTargets =
    process.platform === 'win32' ? await detectWindowsOpenTargets() : []
  const targets = dedupeOpenTargets([
    ...BUILTIN_OPEN_TARGETS,
    ...detectedTargets,
  ])
  return Promise.all(targets.map(target => addOpenTargetIcon(target)))
}

export async function openPathWithDefaultTarget(targetPath: string): Promise<void> {
  const requestedPath = requireNonEmptyString(targetPath, 'Target path')
  const resolvedTarget = assertPathInsideAllowedWorkspace(requestedPath)
  const targetStat = await stat(resolvedTarget)
  const target = await getSelectedOpenTarget()

  if (target.kind === 'file-explorer') {
    if (targetStat.isFile()) {
      shell.showItemInFolder(resolvedTarget)
      return
    }
    await openShellPath(resolvedTarget)
    return
  }

  if (target.kind === 'terminal') {
    await openTerminalAtPath(resolvedTarget, targetStat.isDirectory())
    return
  }

  if (target.kind === 'editor' && target.executablePath) {
    openPathInEditor(target.executablePath, resolvedTarget)
    return
  }

  await openShellPath(resolvedTarget)
}

export async function workspaceFromPath(workspacePath: string): Promise<DesktopWorkspace> {
  const gitInfo = await getWorkspaceGitInfo(workspacePath)
  return {
    path: workspacePath,
    name: basename(workspacePath),
    branchName: gitInfo.branchName,
    branches: gitInfo.branches,
    isGitRepo: gitInfo.isGitRepo,
  }
}

async function getSelectedOpenTarget(): Promise<DesktopOpenTarget> {
  const settings = await readDesktopStoredSettings()
  const targets = await listOpenTargets()
  const selected = targets.find(target => target.id === settings.defaultOpenTargetId)
  if (selected) return selected

  if (settings.defaultOpenTargetId !== 'default-app') {
    await saveDesktopStoredSettings({
      ...settings,
      defaultOpenTargetId: 'default-app',
    })
  }
  return DEFAULT_OPEN_TARGET
}

async function addOpenTargetIcon(
  target: DesktopOpenTarget,
): Promise<DesktopOpenTarget> {
  if (!target.executablePath) return target
  try {
    const icon = await app.getFileIcon(target.executablePath, { size: 'normal' })
    return { ...target, iconDataUrl: icon.toDataURL() }
  } catch {
    return target
  }
}

function dedupeOpenTargets(targets: DesktopOpenTarget[]): DesktopOpenTarget[] {
  const seenIds = new Set<string>()
  const seenLabels = new Set<string>()
  const deduped: DesktopOpenTarget[] = []
  for (const target of targets) {
    const id = target.id.toLocaleLowerCase()
    const label = target.label.toLocaleLowerCase()
    if (seenIds.has(id) || (target.kind === 'editor' && seenLabels.has(label))) {
      continue
    }
    seenIds.add(id)
    seenLabels.add(label)
    deduped.push(target)
  }
  return deduped
}

async function detectWindowsOpenTargets(): Promise<DesktopOpenTarget[]> {
  const candidates: Array<{ label: string; executablePath: string }> = []
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']

  await appendFirstWhereCandidate(candidates, 'VS Code', ['code'], path =>
    resolveCommandBackedExecutable(path, 'Code.exe'),
  )
  await appendFirstExistingCandidate(candidates, 'VS Code', [
    joinOptional(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    joinOptional(programFiles, 'Microsoft VS Code', 'Code.exe'),
    joinOptional(programFilesX86, 'Microsoft VS Code', 'Code.exe'),
  ])
  await appendFirstWhereCandidate(candidates, 'Cursor', ['cursor'], path =>
    resolveCommandBackedExecutable(path, 'Cursor.exe'),
  )
  await appendFirstExistingCandidate(candidates, 'Cursor', [
    joinOptional(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
    joinOptional(programFiles, 'Cursor', 'Cursor.exe'),
    joinOptional(programFilesX86, 'Cursor', 'Cursor.exe'),
  ])
  await appendFirstWhereCandidate(candidates, 'Windsurf', ['windsurf'], path =>
    resolveCommandBackedExecutable(path, 'Windsurf.exe'),
  )
  await appendFirstExistingCandidate(candidates, 'Windsurf', [
    joinOptional(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe'),
    joinOptional(programFiles, 'Windsurf', 'Windsurf.exe'),
    joinOptional(programFilesX86, 'Windsurf', 'Windsurf.exe'),
  ])
  await appendFirstExistingCandidate(candidates, 'Android Studio', [
    joinOptional(programFiles, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
    joinOptional(programFilesX86, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
  ])

  candidates.push(...(await detectVisualStudioTargets()))
  candidates.push(...(await detectJetBrainsTargets()))

  return candidates.map(candidate => ({
    id: `app:${candidate.executablePath}`,
    label: candidate.label,
    kind: 'editor',
    executablePath: candidate.executablePath,
  }))
}

async function appendFirstExistingCandidate(
  candidates: Array<{ label: string; executablePath: string }>,
  label: string,
  executablePaths: Array<string | null>,
): Promise<void> {
  if (candidates.some(candidate => candidate.label === label)) {
    return
  }
  for (const executablePath of executablePaths) {
    if (executablePath && (await fileExists(executablePath))) {
      candidates.push({ label, executablePath })
      return
    }
  }
}

async function appendFirstWhereCandidate(
  candidates: Array<{ label: string; executablePath: string }>,
  label: string,
  commands: string[],
  resolveExecutablePath?: (commandPath: string) => string | null,
): Promise<void> {
  if (candidates.some(candidate => candidate.label === label)) {
    return
  }
  for (const command of commands) {
    const commandVariants = command.toLocaleLowerCase().endsWith('.exe')
      ? [command, command.slice(0, -4)]
      : [command]
    for (const commandPath of await findWindowsCommands(commandVariants)) {
      const executablePath = resolveExecutablePath?.(commandPath) ?? commandPath
      if (executablePath && (await fileExists(executablePath))) {
        candidates.push({ label, executablePath })
        return
      }
    }
  }
}

async function detectVisualStudioTargets(): Promise<
  Array<{ label: string; executablePath: string }>
> {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .map(root => joinOptional(root, 'Microsoft Visual Studio'))
    .filter((root): root is string => Boolean(root))

  for (const root of roots) {
    const yearEntries = (await readDirectoryEntries(root))
      .filter(entry => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name))
    for (const yearEntry of yearEntries) {
      const yearPath = join(root, yearEntry.name)
      const editionEntries = (await readDirectoryEntries(yearPath)).filter(entry =>
        entry.isDirectory(),
      )
      for (const editionEntry of editionEntries) {
        const executablePath = join(
          yearPath,
          editionEntry.name,
          'Common7',
          'IDE',
          'devenv.exe',
        )
        if (await fileExists(executablePath)) {
          return [{ label: 'Visual Studio', executablePath }]
        }
      }
    }
  }
  return []
}

async function detectJetBrainsTargets(): Promise<
  Array<{ label: string; executablePath: string }>
> {
  const roots = [
    joinOptional(process.env.LOCALAPPDATA, 'Programs', 'JetBrains'),
    joinOptional(process.env.ProgramFiles, 'JetBrains'),
    joinOptional(process.env['ProgramFiles(x86)'], 'JetBrains'),
  ]
    .filter((root): root is string => Boolean(root))
  const targets: Array<{ label: string; executablePath: string }> = []

  for (const product of JETBRAINS_WINDOWS_PRODUCTS) {
    await appendFirstWhereCandidate(
      targets,
      product.label,
      product.executables,
    )
    for (const root of roots) {
      const productEntries = (await readDirectoryEntries(root))
        .filter(entry => entry.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name))
      for (const productEntry of productEntries) {
        const normalizedName = productEntry.name.toLocaleLowerCase()
        if (!product.matches.some(match => normalizedName.includes(match))) {
          continue
        }
        for (const executable of product.executables) {
          const executablePath = join(root, productEntry.name, 'bin', executable)
          if (await fileExists(executablePath)) {
            targets.push({ label: product.label, executablePath })
            break
          }
        }
        if (targets.some(target => target.label === product.label)) {
          break
        }
      }
      if (targets.some(target => target.label === product.label)) {
        break
      }
    }
  }
  return targets
}

async function findWindowsCommands(commands: string[]): Promise<string[]> {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const command of commands) {
    for (const commandPath of await findWindowsCommand(command)) {
      const key = commandPath.toLocaleLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        paths.push(commandPath)
      }
    }
  }
  return paths
}

async function findWindowsCommand(command: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('where.exe', [command])
    return stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function resolveCommandBackedExecutable(
  commandPath: string,
  executableName: string,
): string | null {
  const binDirectory = dirname(commandPath)
  const appDirectory = dirname(binDirectory)
  return join(appDirectory, executableName)
}


function joinOptional(
  root: string | undefined,
  ...segments: string[]
): string | null {
  if (!root) return null
  return join(root, ...segments)
}

async function fileExists(path: string | null): Promise<boolean> {
  if (!path) return false
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

async function openShellPath(targetPath: string): Promise<void> {
  const error = await shell.openPath(targetPath)
  if (error) {
    throw new Error(error)
  }
}

async function openTerminalAtPath(
  targetPath: string,
  targetIsDirectory: boolean,
): Promise<void> {
  const cwd = targetIsDirectory ? targetPath : dirname(targetPath)
  if (process.platform === 'win32') {
    const child = spawn(
      'cmd.exe',
      [
        '/c',
        'start',
        '',
        'powershell.exe',
        '-NoExit',
        '-Command',
        `Set-Location -LiteralPath ${quotePowerShellPath(cwd)}`,
      ],
      { cwd, detached: true, stdio: 'ignore', windowsHide: true },
    )
    child.unref()
    return
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', 'Terminal', cwd])
    return
  }
  const child = spawn('x-terminal-emulator', [], {
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function quotePowerShellPath(targetPath: string): string {
  return `'${targetPath.replace(/'/g, "''")}'`
}

function openPathInEditor(executablePath: string, targetPath: string): void {
  const child = spawn(executablePath, [targetPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', () => {})
  child.unref()
}

export async function getStandaloneWorkspace(): Promise<DesktopWorkspace> {
  const workspacePath = getStandaloneWorkspacePath()
  await mkdir(workspacePath, { recursive: true })
  return getStandaloneWorkspaceMetadata()
}

export async function getWorkspaceContext(workspacePath: string): Promise<DesktopWorkspace> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  return workspaceFromPath(resolvedWorkspace)
}

export async function checkoutWorkspaceBranch(
  workspacePath: string,
  branchName: string,
): Promise<DesktopWorkspace> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  const trimmedBranch = branchName.trim()
  if (!trimmedBranch) {
    throw new Error('branchName cannot be empty.')
  }
  await execFileAsync('git', ['-C', resolvedWorkspace, 'checkout', trimmedBranch])
  return getWorkspaceContext(resolvedWorkspace)
}

export async function getWorkspaceGitStatus(
  workspacePath: string,
): Promise<DesktopGitStatusResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
    return { ok: true, status: await readWorkspaceGitStatus(resolvedWorkspace) }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

export async function createWorkspaceBranch(
  input: CreateBranchInput,
): Promise<DesktopGitWorkspaceResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
    const branchName = requireNonEmptyString(input.branchName, 'branchName')
    await assertValidBranchName(branchName)
    const args = ['-C', resolvedWorkspace, 'checkout', '-b', branchName]
    const startPoint = input.startPoint?.trim()
    if (startPoint) {
      args.push(startPoint)
    }
    await execFileAsync('git', args)
    return {
      ok: true,
      workspace: await getWorkspaceContext(resolvedWorkspace),
      status: await readWorkspaceGitStatus(resolvedWorkspace),
    }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

export async function commitWorkspaceChanges(
  input: CommitChangesInput,
): Promise<DesktopGitOperationResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
    const message = requireNonEmptyString(input.message, 'Commit message')
    const paths = validateGitPaths(resolvedWorkspace, input.paths)
    await execFileAsync('git', ['-C', resolvedWorkspace, 'add', '--', ...paths])
    const { stdout, stderr } = await execFileAsync('git', [
      '-C',
      resolvedWorkspace,
      'commit',
      '-m',
      message,
      '--',
      ...paths,
    ])
    return {
      ok: true,
      output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
      status: await readWorkspaceGitStatus(resolvedWorkspace),
    }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

export async function pushWorkspaceBranch(
  input: PushBranchInput,
): Promise<DesktopGitOperationResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
    const branchName = await readGitBranchName(resolvedWorkspace)
    if (!branchName) {
      throw new Error('Cannot push because no current Git branch was detected.')
    }
    const settings = await readDesktopStoredSettings()
    if (input.forceWithLease && !settings.allowForcePush) {
      throw new Error('Force push is disabled in Git settings.')
    }
    const args = ['-C', resolvedWorkspace, 'push']
    if (input.forceWithLease) {
      args.push('--force-with-lease')
    }
    if (input.setUpstream) {
      args.push('--set-upstream', 'origin', branchName)
    }
    const { stdout, stderr } = await execFileAsync('git', args)
    return {
      ok: true,
      output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
      status: await readWorkspaceGitStatus(resolvedWorkspace),
    }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

export async function discardWorkspaceChanges(
  input: DiscardWorkspaceChangesInput,
): Promise<DesktopGitOperationResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
    const paths = validateGitPaths(resolvedWorkspace, input.paths)
    const output: string[] = []
    const trackedPaths = await filterTrackedPaths(resolvedWorkspace, paths)
    if (trackedPaths.length > 0) {
      const { stdout, stderr } = await execFileAsync('git', [
        '-C',
        resolvedWorkspace,
        'checkout',
        '--',
        ...trackedPaths,
      ])
      output.push(
        `[checkout] ${[stdout, stderr].map(s => s.trim()).filter(Boolean).join('\n') || 'ok'}`,
      )
    }
    if (input.includeUntracked) {
      const untrackedPaths = paths.filter(p => !trackedPaths.includes(p))
      if (untrackedPaths.length > 0) {
        const { stdout, stderr } = await execFileAsync('git', [
          '-C',
          resolvedWorkspace,
          'clean',
          '-f',
          '--',
          ...untrackedPaths,
        ])
        output.push(
          `[clean] ${[stdout, stderr].map(s => s.trim()).filter(Boolean).join('\n') || 'ok'}`,
        )
      }
    }
    return {
      ok: true,
      output: output.join('\n'),
      status: await readWorkspaceGitStatus(resolvedWorkspace),
    }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
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
    (stdout as string)
      .split('\0')
      .map(line => line.trim())
      .filter(Boolean),
  )
  return paths.filter(p => tracked.has(p))
}

export async function createPullRequest(
  input: CreatePullRequestInput,
): Promise<DesktopPullRequestResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
    const title = requireNonEmptyString(input.title, 'Pull request title')
    await assertCommandAvailable('gh', 'GitHub CLI (gh) is required to create a pull request.')
    const args = ['pr', 'create', '--title', title]
    const body = input.body?.trim()
    if (body) {
      args.push('--body', body)
    } else {
      args.push('--fill')
    }
    if (input.draft) {
      args.push('--draft')
    }
    const { stdout, stderr } = await execFileAsync('gh', args, {
      cwd: resolvedWorkspace,
    })
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
    const url = output.match(/https:\/\/\S+/)?.[0]
    if (!url) {
      throw new Error(output || 'GitHub CLI did not return a pull request URL.')
    }
    return { ok: true, url, output }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

async function readWorkspaceGitStatus(
  workspacePath: string,
): Promise<DesktopGitStatus> {
  await execFileAsync('git', ['-C', workspacePath, 'rev-parse', '--is-inside-work-tree'])
  const [{ stdout: branchOutput }, { stdout: statusOutput }] =
    await Promise.all([
      execFileAsync('git', ['-C', workspacePath, 'status', '-sb', '--porcelain=v1']),
      execFileAsync('git', [
        '-C',
        workspacePath,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]),
    ])
  const files = parseGitStatusFiles(statusOutput)
  const statByPath = await readGitFileStats(workspacePath)
  const filesWithStats = files.map(file => ({
    ...file,
    additions: statByPath.get(file.path)?.additions ?? null,
    deletions: statByPath.get(file.path)?.deletions ?? null,
  }))
  const branch = parseGitBranchStatus(branchOutput)
  return {
    branchName: branch.branchName,
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    clean: filesWithStats.length === 0,
    files: filesWithStats,
  }
}

function parseGitStatusFiles(statusOutput: string): DesktopGitFileChange[] {
  return statusOutput
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => {
      const stagedStatus = line[0] ?? ' '
      const unstagedStatus = line[1] ?? ' '
      const rawPath = line.slice(3)
      const renameParts = rawPath.split(' -> ')
      const path = renameParts.at(-1)?.trim() ?? rawPath.trim()
      const originalPath =
        renameParts.length > 1 ? renameParts[0]?.trim() : undefined
      return {
        path,
        originalPath,
        status: `${stagedStatus}${unstagedStatus}`,
        stagedStatus,
        unstagedStatus,
        additions: null,
        deletions: null,
        isUntracked: stagedStatus === '?' && unstagedStatus === '?',
      }
    })
}

async function readGitFileStats(
  workspacePath: string,
): Promise<Map<string, { additions: number; deletions: number }>> {
  const stats = new Map<string, { additions: number; deletions: number }>()
  for (const args of [
    ['-C', workspacePath, 'diff', '--numstat', '--'],
    ['-C', workspacePath, 'diff', '--cached', '--numstat', '--'],
  ]) {
    const { stdout } = await execFileAsync('git', args)
    for (const line of stdout.split(/\r?\n/)) {
      const [added, deleted, filePath] = line.split('\t')
      if (!filePath) continue
      const current = stats.get(filePath) ?? { additions: 0, deletions: 0 }
      stats.set(filePath, {
        additions: current.additions + parseNumstatValue(added),
        deletions: current.deletions + parseNumstatValue(deleted),
      })
    }
  }
  return stats
}

function parseNumstatValue(value: string | undefined): number {
  if (!value || value === '-') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseGitBranchStatus(statusOutput: string): {
  branchName: string | null
  upstream: string | null
  ahead: number
  behind: number
} {
  const header = statusOutput.split(/\r?\n/)[0] ?? ''
  if (!header.startsWith('## ')) {
    return { branchName: null, upstream: null, ahead: 0, behind: 0 }
  }
  const withoutPrefix = header.slice(3)
  const metaMatch = /\[(?<meta>[^\]]+)\]$/.exec(withoutPrefix)
  const meta = metaMatch?.groups?.meta ?? ''
  const branchSection = withoutPrefix.replace(/\s+\[[^\]]+\]$/, '')
  const [branchPart, upstreamPart] = branchSection.split('...')
  const branchName = branchPart === 'HEAD' ? null : branchPart || null
  return {
    branchName,
    upstream: upstreamPart || null,
    ahead: parseAheadBehind(meta, 'ahead'),
    behind: parseAheadBehind(meta, 'behind'),
  }
}

function parseAheadBehind(meta: string, key: 'ahead' | 'behind'): number {
  const match = new RegExp(`${key} (\\d+)`).exec(meta)
  return match ? Number(match[1]) : 0
}

async function assertValidBranchName(branchName: string): Promise<void> {
  try {
    await execFileAsync('git', ['check-ref-format', '--branch', branchName])
  } catch {
    throw new Error('Branch name is not valid.')
  }
}

function validateGitPaths(workspacePath: string, paths: string[]): string[] {
  const uniquePaths = [...new Set(paths.map(path => path.trim()).filter(Boolean))]
  if (uniquePaths.length === 0) {
    throw new Error('Select at least one changed file to commit.')
  }
  for (const filePath of uniquePaths) {
    if (filePath.startsWith('-')) {
      throw new Error(`Refusing to use an unsafe Git path: ${filePath}`)
    }
    assertPathInsideAllowedWorkspace(resolve(workspacePath, filePath))
  }
  return uniquePaths
}

async function assertCommandAvailable(
  command: string,
  errorMessage: string,
): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('where.exe', [command])
      return
    }
    await execFileAsync('which', [command])
  } catch {
    throw new Error(errorMessage)
  }
}

async function getWorkspaceGitInfo(
  workspacePath: string,
): Promise<{ branchName: string | null; branches: string[]; isGitRepo: boolean }> {
  try {
    const { stdout: gitRoot } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'rev-parse',
      '--show-toplevel',
    ])
    const normalizedRoot = resolve(gitRoot.trim())
    const branches = await listWorkspaceBranches(workspacePath)
    if (normalizedRoot !== resolve(workspacePath)) {
      return {
        branchName: await readGitBranchName(workspacePath),
        branches,
        isGitRepo: true,
      }
    }
    return {
      branchName: await readGitBranchName(workspacePath),
      branches,
      isGitRepo: true,
    }
  } catch {
    return { branchName: null, branches: [], isGitRepo: false }
  }
}

async function readGitBranchName(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'branch',
      '--show-current',
    ])
    const branchName = stdout.trim()
    return branchName || null
  } catch {
    return null
  }
}

async function listWorkspaceBranches(
  workspacePath: string,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'branch',
      '--format=%(refname:short)',
      '--sort=-committerdate',
    ])
    return stdout
      .split(/\r?\n/)
      .map(branch => branch.trim())
      .filter(Boolean)
      .filter((branch, index, branches) => branches.indexOf(branch) === index)
  } catch {
    return []
  }
}

export async function listWorkspaceFiles(
  workspacePath: string,
): Promise<DesktopFileEntry[]> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  const entries: DesktopFileEntry[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3 || entries.length >= 300) {
      return
    }

    const children = (await readdir(dir, { withFileTypes: true })).sort(
      (left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      },
    )
    for (const child of children) {
      if (child.isDirectory() && IGNORED_DIRECTORY_NAMES.has(child.name)) {
        continue
      }
      const childPath = join(dir, child.name)
      const entry: DesktopFileEntry = {
        name: child.name,
        path: childPath,
        type: child.isDirectory() ? 'directory' : 'file',
        depth,
      }
      entries.push(entry)
      if (child.isDirectory()) {
        await walk(childPath, depth + 1)
      }
      if (entries.length >= 300) {
        return
      }
    }
  }

  await walk(resolvedWorkspace, 0)
  return entries
}

export async function readWorkspaceFile(
  workspacePath: string,
  filePath: string,
): Promise<DesktopFilePreview> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  const resolvedFile = normalizeWorkspacePath(filePath)
  const workspacePrefix = resolvedWorkspace.endsWith(sep)
    ? resolvedWorkspace
    : `${resolvedWorkspace}${sep}`

  if (
    resolvedFile !== resolvedWorkspace &&
    !resolvedFile.startsWith(workspacePrefix)
  ) {
    throw new Error('File is outside the selected workspace.')
  }

  const fileStat = await stat(resolvedFile)
  if (!fileStat.isFile()) {
    throw new Error('Selected entry is not a file.')
  }

  const file = await open(resolvedFile, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(fileStat.size, MAX_FILE_PREVIEW_BYTES))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const truncated = fileStat.size > MAX_FILE_PREVIEW_BYTES
    return {
      path: resolvedFile,
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated,
    }
  } finally {
    await file.close()
  }
}

export async function getWorkspaceDiff(
  workspacePath: string,
): Promise<DesktopDiffSummary> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  try {
    const [{ stdout: diffOutput }, { stdout: statusOutput }] =
      await Promise.all([
        execFileAsync('git', ['-C', resolvedWorkspace, 'diff', '--']),
        execFileAsync('git', [
          '-C',
          resolvedWorkspace,
          'status',
          '--short',
          '--untracked-files=all',
        ]),
      ])
    const status = statusOutput.trim()
    if (!diffOutput && !status) {
      return { patch: 'No file changes.' }
    }
    return {
      patch: [
        status ? `Git status:\n${status}` : null,
        diffOutput ? `Diff:\n${diffOutput}` : 'Diff:\nNo tracked file diff.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { patch: `Unable to read git diff: ${message}` }
  }
}

export async function getWorkspaceReviewDiff(
  input: DesktopReviewDiffInput,
): Promise<DesktopReviewDiffResult> {
  const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
  const activeScope: DesktopReviewScope =
    input.scope === 'staged' ? 'staged' : 'unstaged'
  const status = await readWorkspaceGitStatus(resolvedWorkspace)
  const [unstagedPatch, stagedPatch] = await Promise.all([
    readReviewPatch(resolvedWorkspace, 'unstaged'),
    readReviewPatch(resolvedWorkspace, 'staged'),
  ])
  const unstagedFiles = parseReviewPatch(unstagedPatch, 'unstaged', status)
  const stagedFiles = parseReviewPatch(stagedPatch, 'staged', status)
  appendUntrackedReviewFiles(unstagedFiles, status)
  const files = activeScope === 'staged' ? stagedFiles : unstagedFiles

  return {
    scopes: [
      summarizeReviewScope('unstaged', unstagedFiles),
      summarizeReviewScope('staged', stagedFiles),
    ],
    activeScope,
    files,
    status,
  }
}

export async function applyWorkspaceReviewOperation(
  input: DesktopReviewOperationInput,
): Promise<DesktopReviewOperationResult> {
  try {
    const resolvedWorkspace = assertAllowedWorkspace(input.workspacePath)
    const targetPath = requireNonEmptyString(
      input.target.path,
      'Review target path',
    )
    validateGitPaths(resolvedWorkspace, [targetPath])

    if (input.target.type === 'file') {
      await applyFileReviewOperation(resolvedWorkspace, input, targetPath)
    } else {
      await applyHunkReviewOperation(resolvedWorkspace, input, targetPath)
    }

    const reviewDiff = await getWorkspaceReviewDiff({
      workspacePath: resolvedWorkspace,
      scope: input.scope,
    })
    return { ok: true, status: reviewDiff.status, reviewDiff }
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) }
  }
}

async function readReviewPatch(
  workspacePath: string,
  scope: DesktopReviewScope,
): Promise<string> {
  const args =
    scope === 'staged'
      ? ['-C', workspacePath, 'diff', '--cached', '--']
      : ['-C', workspacePath, 'diff', '--']
  const { stdout } = await execFileAsync('git', args)
  return stdout
}

function parseReviewPatch(
  patch: string,
  scope: DesktopReviewScope,
  status: DesktopGitStatus,
): DesktopReviewDiffFile[] {
  const files: DesktopReviewDiffFile[] = []
  let current: DesktopReviewDiffFile | null = null
  let fileHeader: string[] = []
  let currentHunk: ReviewHunkDraft | null = null
  let oldLine = 0
  let newLine = 0
  let hunkIndex = 0
  let lineIndex = 0

  function finishHunk(): void {
    if (!current || !currentHunk) return
    const id = reviewHunkId(
      current.path,
      hunkIndex,
      currentHunk.oldStart,
      currentHunk.newStart,
    )
    current.hunks.push({
      id,
      header: currentHunk.header,
      oldStart: currentHunk.oldStart,
      oldLines: currentHunk.oldLines,
      newStart: currentHunk.newStart,
      newLines: currentHunk.newLines,
      patch: [...fileHeader, ...currentHunk.rawLines].join('\n') + '\n',
      lines: currentHunk.lines,
    })
    hunkIndex += 1
    currentHunk = null
  }

  function finishFile(): void {
    finishHunk()
    if (current) files.push(current)
    current = null
    fileHeader = []
    currentHunk = null
    oldLine = 0
    newLine = 0
    hunkIndex = 0
    lineIndex = 0
  }

  for (const rawLine of patch.split(/\r?\n/)) {
    if (!rawLine && !currentHunk) continue
    if (rawLine.startsWith('diff --git ')) {
      finishFile()
      const path = parseDiffPath(rawLine)
      const statusFile = status.files.find(file => file.path === path)
      current = {
        path,
        originalPath: statusFile?.originalPath,
        status: scopedReviewStatus(statusFile, scope),
        additions: 0,
        deletions: 0,
        isUntracked: false,
        hunks: [],
      }
      fileHeader = [rawLine]
      continue
    }

    if (!current) continue

    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rawLine)
    if (hunkMatch) {
      finishHunk()
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[3])
      currentHunk = {
        header: rawLine,
        oldStart: oldLine,
        oldLines: Number(hunkMatch[2] ?? '1'),
        newStart: newLine,
        newLines: Number(hunkMatch[4] ?? '1'),
        rawLines: [rawLine],
        lines: [],
      }
      continue
    }

    if (!currentHunk) {
      fileHeader.push(rawLine)
      continue
    }

    currentHunk.rawLines.push(rawLine)
    const id = `${current.path}:${hunkIndex}:${lineIndex++}`
    if (rawLine.startsWith('+')) {
      current.additions += 1
      currentHunk.lines.push({
        id,
        type: 'added',
        oldLine: null,
        newLine,
        content: rawLine.slice(1),
        raw: rawLine,
      })
      newLine += 1
      continue
    }
    if (rawLine.startsWith('-')) {
      current.deletions += 1
      currentHunk.lines.push({
        id,
        type: 'removed',
        oldLine,
        newLine: null,
        content: rawLine.slice(1),
        raw: rawLine,
      })
      oldLine += 1
      continue
    }
    if (rawLine.startsWith(' ')) {
      currentHunk.lines.push({
        id,
        type: 'context',
        oldLine,
        newLine,
        content: rawLine.slice(1),
        raw: rawLine,
      })
      oldLine += 1
      newLine += 1
      continue
    }
    currentHunk.lines.push({
      id,
      type: 'meta',
      oldLine: null,
      newLine: null,
      content: rawLine,
      raw: rawLine,
    })
  }

  finishFile()
  return files
}

type ReviewHunkDraft = {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  rawLines: string[]
  lines: DesktopReviewDiffLine[]
}

function parseDiffPath(diffHeader: string): string {
  const quotedMatch = /^diff --git "a\/(.+)" "b\/(.+)"$/.exec(diffHeader)
  if (quotedMatch?.[2]) {
    return unescapeGitPath(quotedMatch[2])
  }

  const bPrefixIndex = diffHeader.lastIndexOf(' b/')
  if (bPrefixIndex >= 0) {
    return diffHeader.slice(bPrefixIndex + 3)
  }

  const parts = diffHeader.split(' ')
  const last = parts.at(-1) ?? ''
  return last.startsWith('b/') ? last.slice(2) : last
}

function unescapeGitPath(path: string): string {
  return path
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function appendUntrackedReviewFiles(
  files: DesktopReviewDiffFile[],
  status: DesktopGitStatus,
): void {
  const seen = new Set(files.map(file => file.path))
  for (const file of status.files) {
    if (!file.isUntracked || seen.has(file.path)) continue
    files.push({
      path: file.path,
      status: file.status,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      isUntracked: true,
      hunks: [],
    })
  }
}

function summarizeReviewScope(
  scope: DesktopReviewScope,
  files: DesktopReviewDiffFile[],
) {
  return {
    scope,
    changedFiles: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  }
}

function scopedReviewStatus(
  file: DesktopGitFileChange | undefined,
  scope: DesktopReviewScope,
): string {
  if (!file) return scope === 'staged' ? 'M ' : ' M'
  return scope === 'staged'
    ? `${file.stagedStatus} `
    : ` ${file.unstagedStatus}`
}

function reviewHunkId(
  path: string,
  index: number,
  oldStart: number,
  newStart: number,
): string {
  return `${path}:${index}:${oldStart}:${newStart}`
}

async function applyFileReviewOperation(
  workspacePath: string,
  input: DesktopReviewOperationInput,
  path: string,
): Promise<void> {
  if (input.scope === 'unstaged' && input.action === 'stage') {
    await execFileAsync('git', ['-C', workspacePath, 'add', '--', path])
    return
  }
  if (input.scope === 'staged' && input.action === 'unstage') {
    await execFileAsync('git', [
      '-C',
      workspacePath,
      'restore',
      '--staged',
      '--',
      path,
    ])
    return
  }
  if (input.scope === 'unstaged' && input.action === 'revert') {
    const trackedPaths = await filterTrackedPaths(workspacePath, [path])
    if (trackedPaths.length > 0) {
      await execFileAsync('git', [
        '-C',
        workspacePath,
        'restore',
        '--worktree',
        '--',
        path,
      ])
    } else {
      await execFileAsync('git', ['-C', workspacePath, 'clean', '-f', '--', path])
    }
    return
  }
  throw new Error(`Unsupported review operation: ${input.scope} ${input.action}`)
}

async function applyHunkReviewOperation(
  workspacePath: string,
  input: DesktopReviewOperationInput,
  path: string,
): Promise<void> {
  const target = input.target
  if (target.type !== 'hunk') return
  const reviewDiff = await getWorkspaceReviewDiff({
    workspacePath,
    scope: input.scope,
  })
  const file = reviewDiff.files.find(item => item.path === path)
  const hunk = file?.hunks.find(item => item.id === target.hunkId)
  if (!hunk) {
    throw new Error('Review hunk was not found in the current diff.')
  }
  if (input.scope === 'unstaged' && input.action === 'stage') {
    await gitApplyPatch(workspacePath, hunk.patch, ['--cached'])
    return
  }
  if (input.scope === 'staged' && input.action === 'unstage') {
    await gitApplyPatch(workspacePath, hunk.patch, ['--cached', '--reverse'])
    return
  }
  if (input.scope === 'unstaged' && input.action === 'revert') {
    await gitApplyPatch(workspacePath, hunk.patch, ['--reverse'])
    return
  }
  throw new Error(`Unsupported review hunk operation: ${input.scope} ${input.action}`)
}

async function gitApplyPatch(
  workspacePath: string,
  patch: string,
  args: string[],
): Promise<void> {
  const patchPath = join(tmpdir(), `codepilotx-review-${randomUUID()}.patch`)
  await writeFile(patchPath, patch, 'utf8')
  try {
    await execFileAsync('git', ['-C', workspacePath, 'apply', ...args, patchPath])
  } finally {
    await unlink(patchPath).catch(() => undefined)
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`)
  }
  return trimmed
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
