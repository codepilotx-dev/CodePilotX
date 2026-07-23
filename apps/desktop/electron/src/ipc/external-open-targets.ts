import { access } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

export type ExternalOpenTargetKind = "default-app" | "editor"

export type ExternalOpenTarget = {
  targetId: string
  label: string
  kind: ExternalOpenTargetKind
  iconDataUrl?: string
}

type SpawnOptions = {
  detached: true
  shell: false
  stdio: "ignore"
  windowsHide: true
}

type ExternalOpenTargetDependencies = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  fileExists?: (path: string) => Promise<boolean>
  getFileIconDataUrl: (path: string) => Promise<string | null>
  openPath: (path: string) => Promise<string>
  revealPath: (path: string) => void
  spawnProcess: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => { unref(): void }
}

type InstalledTarget = ExternalOpenTarget & {
  executablePath?: string
}

type EditorDefinition = {
  targetId: string
  label: string
  candidates: (env: NodeJS.ProcessEnv) => string[]
}

const editorDefinitions: readonly EditorDefinition[] = [
  {
    targetId: "vscode",
    label: "Visual Studio Code",
    candidates: env => compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
      env.ProgramFiles && join(env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
      env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Microsoft VS Code", "Code.exe"),
    ]),
  },
  {
    targetId: "vscode-insiders",
    label: "Visual Studio Code Insiders",
    candidates: env => compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"),
      env.ProgramFiles && join(env.ProgramFiles, "Microsoft VS Code Insiders", "Code - Insiders.exe"),
      env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Microsoft VS Code Insiders", "Code - Insiders.exe"),
    ]),
  },
  {
    targetId: "cursor",
    label: "Cursor",
    candidates: env => compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "cursor", "Cursor.exe"),
      env.ProgramFiles && join(env.ProgramFiles, "Cursor", "Cursor.exe"),
      env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Cursor", "Cursor.exe"),
    ]),
  },
  {
    targetId: "windsurf",
    label: "Windsurf",
    candidates: env => compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Windsurf", "Windsurf.exe"),
      env.ProgramFiles && join(env.ProgramFiles, "Windsurf", "Windsurf.exe"),
      env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Windsurf", "Windsurf.exe"),
    ]),
  },
]

export class ExternalOpenTargetService {
  readonly #dependencies: ExternalOpenTargetDependencies
  readonly #fileExists: (path: string) => Promise<boolean>

  constructor(dependencies: ExternalOpenTargetDependencies) {
    this.#dependencies = dependencies
    this.#fileExists = dependencies.fileExists ?? fileExists
  }

  async listTargets(targetPath: string): Promise<ExternalOpenTarget[]> {
    assertAbsolutePath(targetPath)
    const targets = await this.#installedTargets(targetPath)
    return targets.map(({ executablePath: _, ...target }) => target)
  }

  async openPathWithTarget(targetPath: string, targetId: string): Promise<void> {
    assertAbsolutePath(targetPath)
    if (typeof targetId !== "string" || !targetId) {
      throw new Error("外部打开目标无效")
    }
    if (targetId === "default-app") {
      await this.#openWithDefaultFallback(targetPath)
      return
    }
    const target = (await this.#installedTargets(targetPath)).find(item => item.targetId === targetId)
    if (!target?.executablePath) {
      throw new Error(`不支持或未安装的外部打开目标：${targetId}`)
    }
    const child = this.#dependencies.spawnProcess(
      target.executablePath,
      [targetPath],
      { detached: true, shell: false, stdio: "ignore", windowsHide: true },
    )
    child.unref()
  }

  revealPathInFolder(targetPath: string): void {
    assertAbsolutePath(targetPath)
    this.#dependencies.revealPath(targetPath)
  }

  async #openWithDefaultFallback(targetPath: string): Promise<void> {
    const error = await this.#dependencies.openPath(targetPath)
    if (!error) return
    if (this.#dependencies.platform === "win32") {
      this.#dependencies.revealPath(targetPath)
      return
    }
    throw new Error(`无法使用系统默认应用打开路径：${error}`)
  }

  async #installedTargets(targetPath: string): Promise<InstalledTarget[]> {
    const defaultTarget: InstalledTarget = {
      targetId: "default-app",
      label: "系统默认应用",
      kind: "default-app",
    }
    const defaultIconDataUrl = await this.#dependencies.getFileIconDataUrl(targetPath).catch(() => null)
    if (defaultIconDataUrl) defaultTarget.iconDataUrl = defaultIconDataUrl
    if (this.#dependencies.platform !== "win32") return [defaultTarget]

    const editors = await Promise.all(editorDefinitions.map(async definition => {
      const executablePath = await firstExistingPath(
        definition.candidates(this.#dependencies.env),
        this.#fileExists,
      )
      if (!executablePath) return null
      const iconDataUrl = await this.#dependencies.getFileIconDataUrl(executablePath).catch(() => null)
      return {
        targetId: definition.targetId,
        label: definition.label,
        kind: "editor" as const,
        executablePath,
        ...(iconDataUrl ? { iconDataUrl } : {}),
      }
    }))
    return [
      defaultTarget,
      ...editors.flatMap(target => target === null ? [] : [target]),
    ]
  }
}

const fileExists = async (path: string): Promise<boolean> =>
  access(path).then(() => true, () => false)

const firstExistingPath = async (
  candidates: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<string | undefined> => {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return undefined
}

const compactPaths = (paths: Array<string | undefined>): string[] =>
  paths.filter((path): path is string => Boolean(path))

const assertAbsolutePath = (path: string): void => {
  if (typeof path !== "string" || !path.trim() || !isAbsolute(path)) {
    throw new Error("只允许打开绝对路径")
  }
}
