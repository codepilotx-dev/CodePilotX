import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { AgentError } from '../domain'
import type { ConfigValue } from '../config/ConfigService'
import type { LocalEnvironmentService } from './LocalEnvironmentService'
import {
  localEnvironmentTrustIdentity,
  type LocalEnvironmentDiscovery,
} from './LocalEnvironmentDiscovery'
import type { LocalEnvironmentRepository } from './LocalEnvironmentRepository'

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const idFor = (gitRoot: string, path: string) => hash(relative(gitRoot, path).replaceAll('\\', '/'))

export class LocalEnvironmentCatalog {
  constructor(
    private readonly service: LocalEnvironmentService,
    private readonly discovery: LocalEnvironmentDiscovery,
    private readonly repository: LocalEnvironmentRepository,
    private readonly projectRoot: (id: string) => string | null,
    private readonly snapshotRoot: string,
  ) {}

  private root(projectId: string) {
    const root = this.projectRoot(projectId)
    if (!root) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
    return root
  }

  private async files(projectId: string) {
    const scopeRoot = resolve(this.root(projectId))
    const discovered = await this.discovery.discover(
      scopeRoot,
      join(scopeRoot, '.codepilotx', 'environments', 'environment.jsonc'),
    )
    const entries: Array<{
      id: string
      name: string
      path: string
      inherited: boolean
      exists: boolean
      invalid: boolean
    }> = []
    let current = scopeRoot
    for (;;) {
      const directory = join(current, '.codepilotx', 'environments')
      const files = await readdir(directory, { withFileTypes: true }).catch(
        (cause: NodeJS.ErrnoException) => {
          if (cause.code === 'ENOENT') return []
          throw cause
        },
      )
      for (const file of files) {
        if (!file.isFile() || file.isSymbolicLink() || !file.name.endsWith('.jsonc')) continue
        const path = join(directory, file.name)
        entries.push({
          id: idFor(discovered.gitRoot, path),
          name: basename(file.name, '.jsonc'),
          path,
          inherited: current !== scopeRoot,
          exists: true,
          invalid: false,
        })
      }
      if (current === discovered.gitRoot) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    if (!entries.length) {
      const path = join(scopeRoot, '.codepilotx', 'environments', 'environment.jsonc')
      entries.push({
        id: idFor(discovered.gitRoot, path),
        name: basename(scopeRoot),
        path,
        inherited: false,
        exists: false,
        invalid: false,
      })
    }
    return { scopeRoot, entries }
  }

  async list(projectId: string) {
    const { scopeRoot, entries } = await this.files(projectId)
    for (const entry of entries.filter((entry) => entry.exists)) {
      try {
        entry.name = String(
          (await this.service.read(scopeRoot, entry.path)).config.name ?? entry.name,
        )
      } catch (cause) {
        if (cause instanceof AgentError && cause.code === 'LOCAL_ENVIRONMENT_INVALID')
          entry.invalid = true
        else throw cause
      }
    }
    const selected = this.repository.selection(projectId)?.config_path
    const automatic = await this.discovery.discover(scopeRoot)
    return {
      environments: entries,
      selectedEnvironmentId:
        entries.find((entry) => entry.path === (selected ?? automatic.filePath))?.id ?? null,
    }
  }

  private async resolveEnvironment(projectId: string, environmentId: string) {
    const result = await this.files(projectId)
    const environment = result.entries.find((entry) => entry.id === environmentId)
    if (!environment) throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '环境不存在', 404)
    return environment
  }

  async read(projectId: string, environmentId: string) {
    const environment = await this.resolveEnvironment(projectId, environmentId)
    return this.service.read(this.root(projectId), environment.path)
  }
  async update(input: {
    projectId: string
    environmentId: string
    expectedRevision: string
    edits?: ReadonlyArray<{ keyPath: readonly (string | number)[]; value: ConfigValue }>
    trust?: { configHash: string; decision: 'allow' | 'revoke' }
  }) {
    const environment = await this.resolveEnvironment(input.projectId, input.environmentId)
    return this.service.update({
      cwd: this.root(input.projectId),
      configPath: environment.path,
      expectedRevision: input.expectedRevision,
      ...(input.edits ? { edits: input.edits } : {}),
      ...(input.trust ? { trust: input.trust } : {}),
    })
  }
  async create(projectId: string, name: string) {
    if (!name.trim()) throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '环境名称不能为空', 400)
    const root = this.root(projectId)
    const path = join(root, '.codepilotx', 'environments', `${randomUUID()}.jsonc`)
    const initial = await this.service.read(root, path)
    await this.service.update({
      cwd: root,
      configPath: path,
      expectedRevision: initial.revision,
      edits: [{ keyPath: ['name'], value: name.trim() }],
    })
    const discovered = await this.discovery.discover(root, path)
    return { environmentId: idFor(discovered.gitRoot, path) }
  }
  async select(projectId: string, environmentId: string) {
    const environment = await this.resolveEnvironment(projectId, environmentId)
    if (!environment.exists || environment.invalid)
      throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '请先保存有效的环境配置', 409)
    await this.service.read(this.root(projectId), environment.path)
    this.repository.select(projectId, this.root(projectId), environment.path)
    return this.list(projectId)
  }
  async delete(projectId: string, environmentId: string, expectedRevision: string) {
    const environment = await this.resolveEnvironment(projectId, environmentId)
    if ((await this.list(projectId)).selectedEnvironmentId === environmentId)
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '请先选择其他默认环境', 409)
    if (this.repository.referenced(environment.path))
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '环境仍为默认选择或被工作树引用', 409)
    const current = await this.service.read(this.root(projectId), environment.path)
    if (current.revision !== expectedRevision)
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '环境已被其他操作修改', 409)
    if (environment.exists) await rm(environment.path)
    return this.list(projectId)
  }
  async freeze(projectId: string, worktreeId: string, sourceRoot: string) {
    if (this.repository.snapshot(worktreeId)) return
    const frozenSource = this.repository.snapshotForCwd(sourceRoot)
    const cwd = frozenSource ? sourceRoot : this.root(projectId)
    const discovered = await this.discovery.discover(cwd)
    const source = await this.service.read(cwd)
    const raw = source.exists
      ? await readFile(source.filePath, 'utf8')
      : JSON.stringify(source.config)
    if (source.exists && hash(raw) !== source.revision)
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '创建工作树期间环境已变化', 409)
    await mkdir(this.snapshotRoot, { recursive: true, mode: 0o700 })
    const directory = await lstat(this.snapshotRoot)
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '环境快照目录无效', 409)
    const path = join(this.snapshotRoot, `${worktreeId}.jsonc`)
    try {
      await writeFile(path, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    }
    this.repository.freeze(
      worktreeId,
      projectId,
      frozenSource?.source_path ?? source.filePath,
      path,
      hash(await readFile(path, 'utf8')),
      localEnvironmentTrustIdentity(discovered),
    )
  }
}
