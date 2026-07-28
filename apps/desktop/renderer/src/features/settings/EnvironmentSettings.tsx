import type { ModelRef } from '@codepilotx/shared'
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  FilePlus2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type {
  DesktopProjectSource,
  DesktopProjectSourceReadResult,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { WorkspaceFileTree } from '../layout/WorkspaceFileTree.js'
import {
  DEFAULT_PROJECT_APPEARANCE,
  ProjectAppearanceGlyph,
} from '../projects/projectAppearance.js'
import { notifyProjectCatalogChanged } from '../projects/projectCatalogEvents.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsSection } from './SettingsSection.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import {
  isProjectSettingsConflict,
  sortEnvironmentProjects,
} from './environmentSettingsModel.js'

type Props = {
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

export function EnvironmentSettings(props: Props): React.ReactNode {
  const { projectId } = useParams<{ projectId?: string }>()
  const location = useLocation()
  const routeBase = location.pathname.startsWith('/projects')
    ? '/projects'
    : '/settings/environment'
  return projectId
    ? (
        <EnvironmentDetail
          projectId={decodeURIComponent(projectId)}
          routeBase={routeBase}
          {...props}
        />
      )
    : <EnvironmentList routeBase={routeBase} {...props} />
}

function EnvironmentList({
  onError,
  routeBase,
}: Props & { routeBase: string }): React.ReactNode {
  const navigate = useNavigate()
  const { projectAppearances } = useDesktopSettings()
  const [projects, setProjects] = useState<DesktopWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setProjects(sortEnvironmentProjects(await desktopClient.listProjects()))
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  const addProject = async (): Promise<void> => {
    if (adding) return
    setAdding(true)
    try {
      const project = await desktopClient.chooseWorkspace()
      if (project) notifyProjectCatalogChanged()
      if (project?.projectId) {
        navigate(`${routeBase}/${encodeURIComponent(project.projectId)}`)
      } else if (project) {
        onError('所选工作区未返回稳定的项目标识。')
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setAdding(false)
    }
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner environment-settings">
        <header className="settings-page-header environment-page-heading">
          <div>
            <h1 className="settings-page-title">环境</h1>
            <p className="settings-page-desc">
              管理项目的默认模型、项目指令和共享来源。
            </p>
          </div>
        </header>

        <SettingsSection
          actions={(
            <Button loading={adding} onClick={() => void addProject()}>
              <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              添加项目
            </Button>
          )}
          bare
          title="选择项目"
          description="最近打开的项目排在前面。"
        >
          {loading ? (
            <EnvironmentEmpty>正在载入项目…</EnvironmentEmpty>
          ) : projects.length === 0 ? (
            <EnvironmentEmpty>
              暂无项目。选择一个目录来创建或打开项目。
            </EnvironmentEmpty>
          ) : (
            <div className="environment-project-list">
              {projects.map(project => (
                <button
                  className="environment-project-row"
                  key={project.projectId ?? project.id ?? project.path}
                  type="button"
                  onClick={() => {
                    if (!project.projectId) {
                      onError('该项目缺少稳定的项目标识。')
                      return
                    }
                    navigate(
                      `${routeBase}/${encodeURIComponent(project.projectId)}`,
                    )
                  }}
                >
                  <span className="environment-project-icon">
                    <ProjectAppearanceGlyph
                      appearance={
                        project.projectId
                          ? projectAppearances[project.projectId]
                            ?? DEFAULT_PROJECT_APPEARANCE
                          : DEFAULT_PROJECT_APPEARANCE
                      }
                      className="project-appearance-marker"
                      size={APP_ICON_SIZE + 2}
                    />
                  </span>
                  <span className="environment-project-copy">
                    <strong>{project.name}</strong>
                    <span title={project.path}>{project.path}</span>
                  </span>
                  <span className="environment-project-meta">
                    {(project.folders?.length ?? 1)} 个目录
                  </span>
                  <Plus
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </button>
              ))}
            </div>
          )}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

function EnvironmentDetail({
  projectId,
  routeBase,
  onError,
  onNotice,
}: Props & { projectId: string; routeBase: string }): React.ReactNode {
  const navigate = useNavigate()
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const [project, setProject] = useState<DesktopWorkspace | null>(null)
  const [draftName, setDraftName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [defaultModelKey, setDefaultModelKey] = useState('')
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [sources, setSources] = useState<DesktopProjectSource[]>([])
  const [sourceFolderId, setSourceFolderId] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [relinkSourceId, setRelinkSourceId] = useState<string | null>(null)
  const [preview, setPreview] =
    useState<DesktopProjectSourceReadResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const loadProject = useCallback(async (
    preserveDraft: boolean,
  ): Promise<DesktopWorkspace | null> => {
    const projects = await desktopClient.listProjects()
    const next = projects.find(item => item.projectId === projectId) ?? null
    setProject(next)
    if (next && !preserveDraft) {
      setDraftName(next.name)
      setInstructions(next.projectSettings?.instructions ?? '')
      setDefaultModelKey(modelKey(next.projectSettings?.defaultModel ?? null))
      setSourceFolderId(next.primaryFolderId ?? next.folders?.[0]?.id ?? '')
      setRelinkSourceId(null)
    }
    return next
  }, [projectId])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await loadProject(false)
      if (next) {
        const [nextSources, providerState] = await Promise.all([
          desktopClient.listProjectSources(projectId),
          desktopClient.getModelProviderState(),
        ])
        setSources(nextSources)
        const models = providerState.models.map(id => ({
          providerID: String(providerState.selectedProviderID),
          id,
        }))
        const configured = next.projectSettings?.defaultModel
        if (
          configured
          && !models.some(model =>
            model.providerID === configured.providerID
            && model.id === configured.id)
        ) {
          models.unshift({
            providerID: configured.providerID,
            id: configured.id,
          })
        }
        setModelOptions(models)
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [loadProject, onError, projectId])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (
    key: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (busy) return
    setBusy(key)
    try {
      await action()
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const saveProject = async (): Promise<void> => {
    if (!project || busy) return
    const name = draftName.trim()
    if (!name) {
      onError('项目名称不能为空。')
      return
    }
    setBusy('save')
    try {
      let next = project
      if (name !== project.name) {
        next = await desktopClient.updateProject({
          projectId,
          name,
          expectedVersion: project.projectVersion ?? 0,
        })
      }
      const selectedModel = parseModelKey(defaultModelKey)
      const currentModel = next.projectSettings?.defaultModel ?? null
      if (
        instructions !== (next.projectSettings?.instructions ?? '')
        || !sameModel(selectedModel, currentModel)
      ) {
        next = await desktopClient.updateProjectSettings({
          projectId,
          instructions,
          defaultModel: selectedModel,
          expectedVersion: next.projectSettings?.version ?? 0,
        })
      }
      setProject(next)
      setDraftName(next.name)
      setInstructions(next.projectSettings?.instructions ?? '')
      setDefaultModelKey(modelKey(next.projectSettings?.defaultModel ?? null))
      notifyProjectCatalogChanged()
      onNotice?.('项目设置已保存。')
    } catch (error) {
      notifyProjectCatalogChanged()
      if (isProjectSettingsConflict(error)) {
        try {
          await loadProject(true)
        } catch (refreshError) {
          onError(errorMessage(refreshError))
          return
        }
        onNotice?.('项目已在其他窗口更新。已刷新版本，请确认当前内容后重试。')
      } else {
        onError(errorMessage(error))
      }
    } finally {
      setBusy(null)
    }
  }

  const importFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    const selected = [...files].slice(0, 8)
    await run('upload', async () => {
      const uploads = await Promise.all(
        selected.map(async file => {
          const isImage = file.type.startsWith('image/')
          return {
            kind: isImage ? 'image' as const : 'text' as const,
            name: file.name,
            mediaType: file.type || (isImage ? 'image/png' : 'text/plain'),
            encoding: isImage ? 'base64' as const : 'utf8' as const,
            data: isImage
              ? arrayBufferToBase64(await file.arrayBuffer())
              : await file.text(),
          }
        }),
      )
      setSources(await desktopClient.importProjectSources(projectId, uploads))
      onNotice?.(`已导入 ${uploads.length} 个共享来源。`)
    })
  }

  const addReference = async (): Promise<void> => {
    if (!sourceFolderId || !sourcePath.trim()) return
    await run('reference', async () => {
      const relinking = sources.find(source => source.id === relinkSourceId)
      if (
        relinking?.storage === 'workspace-file'
        && relinking.folderId === sourceFolderId
        && relinking.path === sourcePath.trim()
      ) {
        throw new Error('重新关联时请选择不同的目录或相对路径。')
      }
      await desktopClient.addProjectSourceReference(
        projectId,
        sourceFolderId,
        sourcePath.trim(),
      )
      if (relinkSourceId) {
        await desktopClient.removeProjectSource(projectId, relinkSourceId)
      }
      setSources(await desktopClient.listProjectSources(projectId))
      setSourcePath('')
      setRelinkSourceId(null)
      onNotice?.(
        relinkSourceId
          ? '共享来源已重新关联。'
          : '工作区文件已添加为共享来源。',
      )
    })
  }

  const previewSource = async (
    source: DesktopProjectSource,
  ): Promise<void> => {
    if (source.status !== 'available') return
    await run(`preview:${source.id}`, async () => {
      setPreview(await desktopClient.readProjectSource(
        projectId,
        source.id,
        source.kind === 'text' ? { offset: 0, length: 64 * 1024 } : undefined,
      ))
    })
  }

  if (loading) {
    return (
      <SettingsContentArea>
        <div className="settings-content-inner environment-settings">
          <EnvironmentEmpty>正在载入项目环境…</EnvironmentEmpty>
        </div>
      </SettingsContentArea>
    )
  }

  if (!project) {
    return (
      <SettingsContentArea>
        <div className="settings-content-inner environment-settings">
          <button
            className="environment-breadcrumb"
            type="button"
            onClick={() => navigate(routeBase)}
          >
            <ArrowLeft size={APP_ICON_SIZE} />
            返回环境
          </button>
          <EnvironmentEmpty>项目不存在、已移除或当前不可用。</EnvironmentEmpty>
        </div>
      </SettingsContentArea>
    )
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner environment-settings">
        <button
          className="environment-breadcrumb"
          type="button"
          onClick={() => navigate(routeBase)}
        >
          <ArrowLeft size={APP_ICON_SIZE} />
          环境
          <ChevronRight aria-hidden="true" size={APP_ICON_SIZE - 2} />
          <span>{project.name}</span>
          <ChevronRight aria-hidden="true" size={APP_ICON_SIZE - 2} />
          <span>编辑</span>
        </button>

        <header className="settings-page-header environment-page-heading">
          <div>
            <h1 className="settings-page-title">编辑本地环境</h1>
            <p className="settings-page-desc" title={project.path}>
              {project.path}
            </p>
          </div>
          <Button loading={busy === 'save'} onClick={() => void saveProject()}>
            保存更改
          </Button>
        </header>

        <SettingsSection
          title="基本信息"
          description="名称、默认模型与项目任务的共享指令一起保存。"
        >
          <label className="environment-field">
            <span>项目名称</span>
            <input
              maxLength={120}
              value={draftName}
              onChange={event => setDraftName(event.target.value)}
            />
          </label>
          <label className="environment-field">
            <span>默认模型</span>
            <select
              value={defaultModelKey}
              onChange={event => setDefaultModelKey(event.target.value)}
            >
              <option value="">继承全局默认模型</option>
              {modelOptions.map(model => {
                const value = `${model.providerID}\u0000${model.id}`
                return (
                  <option key={value} value={value}>
                    {model.providerID} / {model.id}
                  </option>
                )
              })}
            </select>
          </label>
          <label className="environment-field environment-field-textarea">
            <span>项目指令</span>
            <small>
              应用于该项目的每个新轮次；AGENTS、Skills 与配置仍只从主目录发现。
            </small>
            <textarea
              rows={9}
              value={instructions}
              onChange={event => setInstructions(event.target.value)}
            />
          </label>
        </SettingsSection>

        <SettingsSection
          title="共享来源"
          description="来源操作立即生效，不需要点击页面顶部的保存。"
          actions={(
            <>
              <input
                hidden
                multiple
                ref={uploadRef}
                type="file"
                onChange={event => {
                  void importFiles(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
              <Button
                loading={busy === 'upload'}
                onClick={() => uploadRef.current?.click()}
              >
                <Upload size={APP_ICON_SIZE} />
                上传来源
              </Button>
            </>
          )}
        >
          <div className="environment-source-file-tree">
            <WorkspaceFileTree
              files={[]}
              searchable={false}
              workspace={project}
              onOpenFile={file => {
                if (file.type !== 'file' || !file.folderId) return
                setSourceFolderId(file.folderId)
                setSourcePath(file.path)
              }}
            />
          </div>
          <div className="environment-source-reference">
            <select
              aria-label="来源所属目录"
              value={sourceFolderId}
              onChange={event => setSourceFolderId(event.target.value)}
            >
              {(project.folders ?? []).map(folder => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}{folder.role === 'primary' ? '（主目录）' : ''}
                </option>
              ))}
            </select>
            <input
              aria-label="工作区文件相对路径"
              placeholder="docs/overview.md"
              value={sourcePath}
              onChange={event => setSourcePath(event.target.value)}
            />
            <Button
              disabled={busy !== null || !sourcePath.trim()}
              onClick={() => void addReference()}
            >
              <FilePlus2 size={APP_ICON_SIZE} />
              {relinkSourceId ? '重新关联' : '添加文件'}
            </Button>
            {relinkSourceId ? (
              <Button
                disabled={busy !== null}
                onClick={() => {
                  setRelinkSourceId(null)
                  setSourcePath('')
                }}
              >
                取消
              </Button>
            ) : null}
          </div>

          {sources.length === 0 ? (
            <EnvironmentEmpty>暂无共享来源。</EnvironmentEmpty>
          ) : (
            <div className="environment-source-list">
              {sources.map(source => (
                <div className="environment-source-row" key={source.id}>
                  <div>
                    <strong>{source.name}</strong>
                    <span>
                      {source.storage === 'managed' ? '托管文件' : source.path}
                    </span>
                  </div>
                  <span
                    className="environment-source-status"
                    data-status={source.status}
                  >
                    {sourceStatusLabel(source.status)}
                  </span>
                  <button
                    aria-label={`预览来源 ${source.name}`}
                    disabled={busy !== null || source.status !== 'available'}
                    title="预览"
                    type="button"
                    onClick={() => void previewSource(source)}
                  >
                    <Eye size={APP_ICON_SIZE} />
                  </button>
                  <button
                    aria-label={`重新关联来源 ${source.name}`}
                    disabled={
                      busy !== null
                      || source.storage !== 'workspace-file'
                      || source.status === 'available'
                    }
                    hidden={
                      source.storage !== 'workspace-file'
                      || source.status === 'available'
                    }
                    title="重新关联"
                    type="button"
                    onClick={() => {
                      if (source.storage !== 'workspace-file') return
                      setRelinkSourceId(source.id)
                      setSourceFolderId(source.folderId)
                      setSourcePath(source.path)
                    }}
                  >
                    <RefreshCw size={APP_ICON_SIZE} />
                  </button>
                  <button
                    aria-label={`移除来源 ${source.name}`}
                    disabled={busy !== null}
                    title="移除"
                    type="button"
                    onClick={() => void run(`remove:${source.id}`, async () => {
                      if (
                        await desktopClient.removeProjectSource(
                          projectId,
                          source.id,
                        )
                      ) {
                        setSources(current =>
                          current.filter(item => item.id !== source.id),
                        )
                        if (preview?.source.id === source.id) setPreview(null)
                        onNotice?.('共享来源已移除。')
                      }
                    })}
                  >
                    <Trash2 size={APP_ICON_SIZE} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {preview ? (
            <div className="environment-source-preview">
              <header>
                <strong>{preview.source.name}</strong>
                <button
                  aria-label="关闭来源预览"
                  type="button"
                  onClick={() => setPreview(null)}
                >
                  <X size={APP_ICON_SIZE} />
                </button>
              </header>
              {preview.encoding === 'base64' ? (
                <img
                  alt={preview.source.name}
                  src={`data:${sourceMediaType(preview.source)};base64,${preview.data}`}
                />
              ) : (
                <pre>{preview.data}</pre>
              )}
              {preview.range.length < preview.range.total ? (
                <small>
                  仅预览前 {preview.range.length} / {preview.range.total} 字节
                </small>
              ) : null}
            </div>
          ) : null}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

function EnvironmentEmpty({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return <p className="environment-empty">{children}</p>
}

type ModelOption = {
  providerID: string
  id: string
}

function modelKey(model: ModelRef | null): string {
  return model ? `${model.providerID}\u0000${model.id}` : ''
}

function parseModelKey(value: string): ModelRef | null {
  const [providerID, id] = value.split('\u0000')
  return providerID && id ? { providerID, id } as ModelRef : null
}

function sameModel(left: ModelRef | null, right: ModelRef | null): boolean {
  return left?.providerID === right?.providerID && left?.id === right?.id
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function sourceStatusLabel(
  status: DesktopProjectSource['status'],
): string {
  if (status === 'available') return '可用'
  if (status === 'missing') return '文件缺失'
  if (status === 'denied') return '拒绝访问'
  return '不支持'
}

function sourceMediaType(source: DesktopProjectSource): string {
  if (source.storage === 'managed') return source.mediaType
  const extension = source.path.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  return 'image/png'
}
