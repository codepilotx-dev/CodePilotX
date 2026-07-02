import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  CODEPILOTX_CONFIG_DIR_NAME,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import { getOpenAgentConfigHomeDir } from './desktopSettings.js'
import type {
  DesktopDataLocationControlSource,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
} from '../shared/types.js'

const BOOTSTRAP_FILE_NAME = 'codepilotx-config-bootstrap'

/**
 * Create platform-specific bootstrap file path helper.
 * The file lives under Electron's userData directory and contains
 * the absolute path to the `.codepilotx` config directory to use
 * on the next launch.
 */
export function getBootstrapFilePath(userDataPath: string): string {
  return join(userDataPath, BOOTSTRAP_FILE_NAME)
}

/**
 * Read the bootstrap pointer file synchronously (called at module init).
 * Returns the stored config directory path, or `null` if no bootstrap
 * file exists or it cannot be parsed.
 */
export function readBootstrapConfigDirWithPath(userDataPath: string): string | null {
  const filePath = getBootstrapFilePath(userDataPath)
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    const trimmed = raw.trim()
    if (!trimmed) return null
    // Basic sanity: must be an absolute path
    if (!trimmed.startsWith('/') && !trimmed.match(/^[A-Za-z]:[\\/]/)) {
      return null
    }
    return trimmed
  } catch {
    return null
  }
}

/**
 * Read the bootstrap pointer using Electron's app.getPath('userData').
 * This version imports Electron at call-time.
 */
export function readBootstrapConfigDir(): string | null {
  // Dynamic import to allow testing without Electron
  try {
    const userDataPath = getElectronUserDataPath()
    return readBootstrapConfigDirWithPath(userDataPath)
  } catch {
    return null
  }
}

/**
 * Atomically write the bootstrap pointer file.
 */
export async function writeBootstrapConfigDir(configDir: string): Promise<void> {
  const userDataPath = getElectronUserDataPath()
  const filePath = getBootstrapFilePath(userDataPath)
  await mkdir(userDataPath, { recursive: true })
  // Write to a temp file first, then rename for atomicity
  const tmpPath = filePath + '.tmp'
  await writeFile(tmpPath, configDir + '\n', 'utf-8')
  try {
    await rename(tmpPath, filePath)
  } catch {
    // If rename fails (e.g. cross-device), fall back to direct write
    await writeFile(filePath, configDir + '\n', 'utf-8')
  }
}

/**
 * Normalize the user-selected directory:
 * - If the selected directory's basename is already `.codepilotx`, use it directly.
 * - Otherwise, append `.codepilotx` to it.
 */
export function normalizeSelectedDirectory(selectedPath: string): string {
  const resolved = resolve(selectedPath.trim())
  if (basename(resolved) === CODEPILOTX_CONFIG_DIR_NAME) {
    return resolved
  }
  return join(resolved, CODEPILOTX_CONFIG_DIR_NAME)
}

/**
 * Validate that the target directory is not the same as the source
 * and not located inside the source directory.
 * Throws an error with a descriptive message if validation fails.
 */
export function validateTargetDirectory(
  sourceDir: string,
  targetDir: string,
): void {
  const src = resolve(sourceDir)
  const tgt = resolve(targetDir)

  if (src === tgt) {
    throw new Error('目标目录与当前数据目录相同。')
  }

  // Check if target is inside source
  const rel = relative(src, tgt)
  if (rel && !rel.startsWith('..')) {
    throw new Error('新目录不能位于当前数据目录内部。')
  }
}

/**
 * Recursively copy all contents from sourceDir to targetDir.
 * Existing files in targetDir are overwritten by source files.
 * Directories that exist only in targetDir are preserved.
 */
export async function migrateConfigDir(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  await copyRecursive(sourceDir, targetDir)
}

/**
 * Determine the control source for the current config directory.
 */
export function getDataLocationControlSource(userDataPath?: string): DesktopDataLocationControlSource {
  if (process.env[CODEPILOTX_CONFIG_DIR_ENV]) {
    return 'env'
  }
  if (process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]) {
    return 'env'
  }
  const bootstrapDir = userDataPath
    ? readBootstrapConfigDirWithPath(userDataPath)
    : readBootstrapConfigDir()
  if (bootstrapDir) {
    return 'bootstrap'
  }
  return 'default'
}

/**
 * Resolve the effective config directory respecting the bootstrap file.
 * Priority: env var > bootstrap file > default homedir.
 */
export function resolveEffectiveConfigDir(): string {
  const isEnvOverridden =
    !!process.env[CODEPILOTX_CONFIG_DIR_ENV] ||
    !!process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]

  if (isEnvOverridden) {
    return getOpenAgentConfigHomeDir()
  }

  const bootstrapDir = readBootstrapConfigDir()
  if (bootstrapDir) {
    return bootstrapDir
  }

  return getOpenAgentConfigHomeDir()
}

/**
 * Get the current data location state for the settings UI.
 */
export function getDataLocationState(): DesktopDataLocationState {
  const userDataPath = getElectronUserDataPath()
  const controlSource = getDataLocationControlSource(userDataPath)
  const currentConfigDir = resolveEffectiveConfigDir()
  const bootstrapDir = readBootstrapConfigDirWithPath(userDataPath)
  const isEnvControlled = controlSource === 'env'

  // Compute pending: bootstrap points to a dir different from what is currently active
  const pendingConfigDir =
    bootstrapDir && bootstrapDir !== currentConfigDir
      ? bootstrapDir
      : null

  return {
    currentConfigDir,
    pendingConfigDir,
    controlSource,
    isEnvControlled,
  }
}

/**
 * Choose a new data location and perform migration.
 * This is called from the renderer via IPC.
 * Returns the migration result, or null if the user cancelled the dialog.
 */
export async function chooseAndMigrateDataLocation(): Promise<DesktopDataLocationMigrationResult | null> {
  const sourceDir = resolveEffectiveConfigDir()

  // Dynamically import Electron dialog
  const electronDialog = await importElectronDialog()
  const userDataPath = getElectronUserDataPath()

  // Show native directory picker
  const result = await electronDialog.showOpenDialog({
    title: '选择数据存储位置',
    properties: ['openDirectory', 'createDirectory'],
  })

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  const selectedPath = result.filePaths[0]
  const targetDir = normalizeSelectedDirectory(selectedPath)

  // Validate
  validateTargetDirectory(sourceDir, targetDir)

  // Migrate
  await migrateConfigDir(sourceDir, targetDir)

  // Write bootstrap pointer
  await writeBootstrapConfigDir(targetDir)

  return {
    sourceDir,
    targetDir,
    success: true,
  }
}

// ---- Electron Dependency Resolution ----

function getElectronUserDataPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronApp = require('electron').app
  return electronApp.getPath('userData')
}

async function importElectronDialog(): Promise<{
  showOpenDialog(options: {
    title?: string
    properties?: Array<'openFile' | 'openDirectory' | 'createDirectory'>
  }): Promise<{ canceled: boolean; filePaths: string[] }>
}> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('electron').dialog
}

// ---- Internal Helpers ----

async function copyRecursive(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true })
      await copyRecursive(srcPath, destPath)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // For symlinks, copy the file content (not the link itself)
      await copyFile(srcPath, destPath)
    }
  }
}
