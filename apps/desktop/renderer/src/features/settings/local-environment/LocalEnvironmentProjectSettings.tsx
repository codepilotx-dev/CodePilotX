import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { RpcResult } from '@codepilotx/agent-protocol'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { environmentDomainClient } from '../../../services/desktop-client/environment-domain-client.js'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { SettingsSection } from '../SettingsSection.js'
import { LocalEnvironmentSettings } from './LocalEnvironmentSettings.js'

type Props = { onError: (message: string) => void; onNotice?: (message: string) => void }
type Environment = RpcResult<'local-environment/project/list'>['environments'][number]

export function LocalEnvironmentProjectSettings({ onError, onNotice }: Props): ReactNode {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<DesktopWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const projectId = params.get('projectId')
  const environmentId = params.get('environmentId')
  useEffect(() => {
    void desktopClient
      .listProjects()
      .then(setProjects)
      .catch((cause) => onError(message(cause)))
      .finally(() => setLoading(false))
  }, [onError])
  if (projectId && environmentId)
    return (
      <div className="tw:mt-6 tw:grid tw:gap-4">
        <Button
          color="secondary"
          onClick={() =>
            setParams((current) => {
              current.delete('environmentId')
              return current
            })
          }
        >
          返回环境列表
        </Button>
        <LocalEnvironmentSettings
          key={projectId + environmentId}
          projectId={projectId}
          environmentId={environmentId}
          embedded
          onError={onError}
          onNotice={onNotice}
          onSaved={() => setRevision((value) => value + 1)}
        />
      </div>
    )
  return (
    <div className="tw:mt-6 tw:grid tw:gap-3">
      <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">
        配置项目创建工作树时使用的初始化脚本、清理脚本和 Actions。
      </p>
      <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
        <h3 className="tw:type-row-title tw:text-app-text">选择项目</h3>
        <Button color="secondary" onClick={() => navigate('/projects')}>
          添加项目
        </Button>
      </header>
      {loading ? (
        <p role="status">正在加载项目…</p>
      ) : !projects.length ? (
        <p>暂无项目，添加项目后即可配置环境。</p>
      ) : (
        projects
          .filter((project) => project.projectId)
          .map((project) => (
            <ProjectEnvironmentCard
              key={project.projectId}
              project={project}
              revision={revision}
              onError={onError}
              onOpen={(id) =>
                setParams((current) => {
                  current.set('projectId', project.projectId!)
                  current.set('environmentId', id)
                  current.set('tab', 'environments')
                  return current
                })
              }
            />
          ))
      )}
    </div>
  )
}

function ProjectEnvironmentCard({
  project,
  revision,
  onOpen,
  onError,
}: {
  project: DesktopWorkspace
  revision: number
  onOpen: (environmentId: string) => void
  onError: (message: string) => void
}): ReactNode {
  const client = useMemo(() => environmentDomainClient(), [])
  const [catalog, setCatalog] = useState<RpcResult<'local-environment/project/list'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState(project.name)
  const [deleting, setDeleting] = useState<{ environment: Environment; revision: string } | null>(
    null,
  )
  const projectId = project.projectId!
  const refresh = useCallback(async () => {
    try {
      setCatalog(await client.listProjectEnvironments(projectId))
      setError(null)
    } catch (cause) {
      setError(message(cause))
    }
  }, [client, projectId])
  useEffect(() => {
    void refresh()
  }, [refresh, revision])
  const execute = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(message(cause))
      onError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection
      title={project.name}
      description={project.path}
      actions={
        <Button
          color="secondary"
          disabled={busy || catalog === null}
          onClick={() => setCreating(true)}
        >
          创建环境
        </Button>
      }
    >
      {error ? (
        <div role="alert" className="tw:type-body-sm tw:text-app-danger">
          {error}
          <Button color="secondary" disabled={busy} onClick={() => void refresh()}>
            重试
          </Button>
        </div>
      ) : null}
      {catalog?.environments.map((environment) => (
        <div
          key={environment.id}
          className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:py-3 tw:[&+&]:border-t tw:[&+&]:border-app-border-subtle"
        >
          <div className="tw:min-w-0 tw:flex-1">
            <div className="tw:type-row-title tw:text-app-text">
              {environment.name}
              {catalog.selectedEnvironmentId === environment.id ? ' · 默认' : ''}
            </div>
            <p className="tw:m-0 tw:type-caption tw:text-app-text-meta tw:break-words">
              {environment.inherited ? '继承自 ' : ''}
              {environment.path}
              {environment.invalid ? ' · 配置无效' : !environment.exists ? ' · 尚未创建' : ''}
            </p>
          </div>
          <div className="tw:flex tw:items-center tw:gap-2">
            <Button color="secondary" disabled={busy} onClick={() => onOpen(environment.id)}>
              编辑
            </Button>
            <Button
              color="secondary"
              disabled={
                busy ||
                !environment.exists ||
                environment.invalid ||
                catalog.selectedEnvironmentId === environment.id
              }
              onClick={() =>
                void execute(async () => {
                  await client.selectProjectEnvironment(projectId, environment.id)
                })
              }
            >
              设为默认
            </Button>
            <Button
              color="danger"
              disabled={
                busy || !environment.exists || catalog.selectedEnvironmentId === environment.id
              }
              onClick={() =>
                void execute(async () => {
                  const current = await client.readProjectEnvironment(projectId, environment.id)
                  setDeleting({ environment, revision: current.revision })
                })
              }
            >
              删除
            </Button>
          </div>
        </div>
      ))}
      <ConfirmationDialog
        open={creating}
        title="创建环境"
        description={
          <Input
            aria-label="环境名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        }
        actionLabel="创建"
        actionDisabled={busy || !name.trim()}
        onCancel={() => {
          if (!busy) setCreating(false)
        }}
        onAction={() =>
          void execute(async () => {
            const created = await client.createProjectEnvironment(projectId, name)
            setCreating(false)
            onOpen(created.environmentId)
          })
        }
      />
      <ConfirmationDialog
        open={deleting !== null}
        title="删除环境？"
        description="将删除环境配置文件；默认选择和工作树引用会阻止删除。"
        actionLabel="删除"
        tone="danger"
        actionDisabled={busy}
        onCancel={() => {
          if (!busy) setDeleting(null)
        }}
        onAction={() =>
          void execute(async () => {
            if (!deleting) return
            await client.deleteProjectEnvironment(
              projectId,
              deleting.environment.id,
              deleting.revision,
            )
            setDeleting(null)
          })
        }
      />
    </SettingsSection>
  )
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '环境操作失败'
}
