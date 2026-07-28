import React, { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import {
  CONFIG_UPDATED_EVENT,
  desktopClient,
} from '../../services/desktop-client/index.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import { PERMISSION_MODE_OPTIONS, permissionConfigForMode, permissionModeForConfig } from './settingsStorage.js'
import type {
  DesktopConfigReadResult,
  DesktopDataLocationState,
  DesktopProjectTrustReadResult,
  DesktopShellSecurityLevel,
} from '../../../shared/types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { TaskModelSelect } from './TaskModelSelect.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'

function LearnMoreLink() {
  return (
    <a
      className="settings-row-link"
      href="#"
      onClick={event => event.preventDefault()}
    >
      了解更多
    </a>
  )
}

export function ConfigSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const { draft } = settings
  const [dataLocation, setDataLocation] = useState<DesktopDataLocationState | null>(
    null,
  )
  const [changingLocation, setChangingLocation] = useState(false)
  const [promptPreview, setPromptPreview] = useState<string | null>(null)
  const [configRead, setConfigRead] = useState<DesktopConfigReadResult | null>(null)
  const [projectTrust, setProjectTrust] = useState<DesktopProjectTrustReadResult | null>(null)
  const [configLayer, setConfigLayer] = useState<'user' | 'project'>('user')
  const [configBusy, setConfigBusy] = useState(false)
  const configCwd = draft.values.lastActiveWorkspacePath || undefined

  const reloadConfig = async () => {
    const [read, trust] = await Promise.all([
      desktopClient.readConfig({
        includeLayers: true,
        ...(configCwd ? { cwd: configCwd } : {}),
      }),
      configCwd
        ? desktopClient.readProjectTrust(configCwd)
        : Promise.resolve(null),
    ])
    setConfigRead(read)
    setProjectTrust(trust)
    if (configLayer === 'project' && !read.layers?.some(layer => layer.kind === 'project')) {
      setConfigLayer('user')
    }
  }

  useEffect(() => {
    let mounted = true
    void Promise.all([
      desktopClient.readConfig({
        includeLayers: true,
        ...(configCwd ? { cwd: configCwd } : {}),
      }),
      configCwd
        ? desktopClient.readProjectTrust(configCwd)
        : Promise.resolve(null),
    ])
      .then(([read, trust]) => {
        if (mounted) {
          setConfigRead(read)
          setProjectTrust(trust)
        }
      })
      .catch(() => {
        if (mounted) {
          setConfigRead(null)
          setProjectTrust(null)
        }
      })
    return () => {
      mounted = false
    }
  }, [configCwd])

  useEffect(() => {
    const refresh = () => void reloadConfig().catch(() => undefined)
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, refresh)
  })

  const selectedConfigLayer = configRead?.layers?.find(
    layer => layer.kind === configLayer,
  )

  const trustCurrentProject = async (): Promise<void> => {
    if (!configCwd || configBusy) return
    setConfigBusy(true)
    try {
      const userVersion = configRead?.layers?.find(
        layer => layer.kind === 'user',
      )?.version
      await desktopClient.updateProjectTrust({
        cwd: configCwd,
        trustLevel: 'trusted',
        ...(userVersion ? { expectedVersion: userVersion } : {}),
      })
      await reloadConfig()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`信任当前工作区失败：${message}`)
    } finally {
      setConfigBusy(false)
    }
  }

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getDataLocation()
      .then(state => {
        if (mounted) setDataLocation(state)
      })
      .catch(() => {
        if (mounted) setDataLocation(null)
      })
    return () => {
      mounted = false
    }
  }, [])

  const handleChooseDataLocation = async (): Promise<void> => {
    if (changingLocation) return
    setChangingLocation(true)
    try {
      const result = await desktopClient.chooseDataLocation()
      if (result) {
        const newState = await desktopClient.getDataLocation()
        setDataLocation(newState)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`更改数据位置失败：${message}`)
    } finally {
      setChangingLocation(false)
    }
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">配置</h2>
          <p className="settings-page-desc">
            配置审批策略和命令执行范围。
            <LearnMoreLink />
          </p>
        </div>

        <SettingsSection
          title="自定义 config.toml 设置"
          description="设置页、外部编辑和自然语言配置共享同一个 TOML 真源。"
          actions={
            <div className="settings-actions">
              <SettingsDropdown
                width={150}
                ariaLabel="配置层"
                value={configLayer}
                options={[
                  { value: 'user', label: '用户配置' },
                  ...(configRead?.layers?.some(layer => layer.kind === 'project')
                    ? [{ value: 'project', label: '项目配置' }]
                    : []),
                ]}
                onChange={value => setConfigLayer(value as 'user' | 'project')}
              />
              <Button
                type="button"
                disabled={!selectedConfigLayer?.filePath || configBusy}
                onClick={() => {
                  if (selectedConfigLayer?.filePath) {
                    void desktopClient.openPathWithDefaultTarget(
                      selectedConfigLayer.filePath,
                    )
                  }
                }}
              >
                <ExternalLink size={APP_ICON_SIZE} />
                打开 config.toml
              </Button>
            </div>
          }
        >
          {configRead?.diagnostics.map(diagnostic => (
            <SettingsRow
              key={`${diagnostic.scope}:${diagnostic.code}`}
              title={diagnostic.code}
              description={
                <span>
                  <AlertTriangle size={APP_ICON_SIZE} /> {diagnostic.message}
                </span>
              }
            />
          ))}
          <SettingsRow
            title="项目配置信任"
            description={
              !configCwd
                ? '请先打开一个工作空间'
                : projectTrust?.trustLevel === 'trusted'
                  ? '当前工作区已信任，可以保存项目级配置'
                  : '当前工作区未信任；保存 local MCP 前请先显式信任'
            }
            control={
              configCwd && projectTrust?.trustLevel === 'untrusted' ? (
                <Button
                  type="button"
                  disabled={configBusy}
                  onClick={() => void trustCurrentProject()}
                >
                  信任当前工作区
                </Button>
              ) : undefined
            }
          />
          <SettingsRow
            title="当前来源"
            description={
              selectedConfigLayer
                ? `${selectedConfigLayer.displayName} · ${selectedConfigLayer.trusted ? '已信任' : '未信任'}`
                : '当前工作区没有项目配置'
            }
            control={
              <Button
                type="button"
                disabled={configBusy}
                onClick={() => void reloadConfig()}
              >
                <RefreshCw size={APP_ICON_SIZE} />
                刷新
              </Button>
            }
          />
        </SettingsSection>

        <SettingsSection title="审批">
          <SettingsRow
            title="批准策略"
            description="选择 CodePilotX 何时请求批准"
            control={
              <SettingsDropdown
                width={260}
                ariaLabel="批准策略"
                value={permissionModeForConfig(draft.values.permissionConfig)}
                options={PERMISSION_MODE_OPTIONS.map(option => ({
                  value: option.value,
                  label: option.label,
                  detail: option.detail,
                }))}
                onChange={value => {
                  const mode = value as Parameters<typeof permissionConfigForMode>[0]
                  if (mode !== 'custom') draft.setValue('permissionConfig', permissionConfigForMode(mode))
                  draft.autoSave()
                }}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="完整提示词诊断"
          description="仅在你主动请求时读取当前任务的 system/developer/contextual-user sections、来源、hash、token 估算和缓存分类；内容不会写入日志或遥测。"
          actions={
            <Button
              type="button"
              onClick={() => void (async () => {
                try {
                  const sessionId = await desktopClient.getActiveSessionId()
                  if (!sessionId) throw new Error('当前没有活动任务')
                  const preview = await desktopClient.getSessionPromptPreview(sessionId)
                  setPromptPreview(JSON.stringify(preview, null, 2))
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : String(error))
                }
              })()}
            >
              预览当前任务提示词
            </Button>
          }
        >
          {promptPreview ? <pre className="settings-code-block">{promptPreview}</pre> : null}
        </SettingsSection>

        <SettingsSection
          title="权限与命令执行"
          description="结构化文件工具遵循所选范围；非计划模式 Shell 经安全规则和 Hook 后以当前 Windows 用户身份执行。"
        >
          <SettingsRow
            title="Shell 安全级别"
            description="调整 Shell 静态风险处理，不改变文件或网络权限范围；批准策略为“从不”时，需要审批的命令会直接拒绝。"
            control={
              <SettingsDropdown
                width={260}
                ariaLabel="Shell 安全级别"
                value={draft.values.shellSecurityLevel}
                options={[
                  { value: 'strict', label: '严格', detail: '更多高风险特征直接拒绝，适合陌生仓库' },
                  { value: 'balanced', label: '平衡', detail: '灾难级行为拒绝，可疑项转审批（推荐）' },
                  { value: 'relaxed', label: '宽松', detail: '保留不可绕过底线，其余高风险尽量转审批' },
                ]}
                onChange={value => {
                  draft.setValue('shellSecurityLevel', value as DesktopShellSecurityLevel)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="工具权限范围"
            description="该范围约束结构化文件工具和审批信号，不是 Shell 子进程的操作系统隔离边界。"
            control={
              <SettingsDropdown
                width={260}
                ariaLabel="工具权限范围"
                value={draft.values.permissionConfig.sandboxMode === 'read-only' ? ':read-only' : draft.values.permissionConfig.sandboxMode === 'danger-full-access' ? ':danger-full-access' : ':workspace'}
                options={[
                  { value: ':read-only', label: '文件工具只读', detail: '结构化文件工具只读；非计划模式 Shell 仍在本机执行' },
                  { value: ':workspace', label: '文件工具限工作区', detail: '结构化文件工具仅写工作区；Shell 没有 OS 文件边界' },
                  { value: ':danger-full-access', label: '完全访问', detail: '所有工具以当前 Windows 用户权限执行（风险很高）' },
                ]}
                onChange={value => {
                  const sandboxMode = value === ':read-only' ? 'read-only' : value === ':danger-full-access' ? 'danger-full-access' : 'workspace-write'
                  draft.setValue('permissionConfig', { ...draft.values.permissionConfig, sandboxMode })
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="批准策略"
            description="选择 CodePilotX 何时请求批准。"
            control={
              <SettingsDropdown
                width={260}
                ariaLabel="批准策略"
                value={typeof draft.values.permissionConfig.approvalPolicy === 'object'
                  ? 'granular'
                  : draft.values.permissionConfig.approvalPolicy === 'on-failure'
                    ? 'on-request'
                    : draft.values.permissionConfig.approvalPolicy}
                options={[
                  { value: 'untrusted', label: '不可信', detail: '执行不受信任的操作前请求批准' },
                  { value: 'on-request', label: '按请求', detail: '需要提升权限时请求批准' },
                  { value: 'granular', label: '精细控制', detail: '分别控制不同类别的审批请求' },
                  { value: 'never', label: '从不', detail: '运行操作时不请求批准' },
                ]}
                onChange={value => {
                  const approvalPolicy = value === 'granular'
                    ? { type: 'granular' as const, sandboxApproval: true, rules: true, skillApproval: true, requestPermissions: true, mcpTools: true, mcpElicitations: true }
                    : value as 'untrusted' | 'on-request' | 'never'
                  draft.setValue('permissionConfig', { ...draft.values.permissionConfig, approvalPolicy })
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="审批执行者"
            description="选择由你还是独立 Guardian 处理需要审批的操作。"
            control={
              <SettingsDropdown
                width={260}
                ariaLabel="审批执行者"
                value={draft.values.permissionConfig.approvalsReviewer}
                options={[
                  { value: 'user', label: '用户', detail: '由你确认或拒绝审批请求' },
                  { value: 'auto_review', label: 'Guardian 自动审查', detail: '由独立 Guardian 模型处理审批请求' },
                ]}
                onChange={value => { const approvalsReviewer = value as 'user' | 'auto_review'; draft.setValue('permissionConfig', { ...draft.values.permissionConfig, approvalsReviewer }); draft.autoSave() }}
              />
            }
          />
          {typeof draft.values.permissionConfig.approvalPolicy === 'object' ? (
            <>
              {([
                ['sandboxApproval', '执行范围提升'],
                ['rules', '规则审批'],
                ['skillApproval', 'Skill 脚本'],
                ['requestPermissions', '动态权限请求'],
                ['mcpTools', 'MCP 工具调用'],
                ['mcpElicitations', 'MCP 交互请求'],
              ] as const).map(([key, label]) => (
                <SettingsRow
                  key={key}
                  title={label}
                  description="允许该类审批请求出现；关闭时需要该能力的调用会直接拒绝。"
                  control={<ToggleSwitch checked={draft.values.permissionConfig.approvalPolicy[key]} onChange={checked => {
                    const policy = draft.values.permissionConfig.approvalPolicy
                    if (typeof policy !== 'object') return
                    const approvalPolicy = { ...policy, [key]: checked }
                    draft.setValue('permissionConfig', { ...draft.values.permissionConfig, approvalPolicy })
                    draft.autoSave()
                  }} />}
                />
              ))}
            </>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="任务模型"
          description="这些模型对应轻量、常规和深度任务入口；留空时会使用上面的会话主模型。"
        >
          <SettingsRow
            title="快速模型"
            description="用于标题、摘要、Hook、检索等轻量辅助任务；未配置时使用主模型。"
            control={
              <TaskModelSelect
                value={draft.values.smallFastModel}
                mainModel={settings.model}
                taskModelKey="smallFastModel"
                onChange={v => {
                  draft.setValue('smallFastModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="快速任务模型"
            description="用于低成本子任务、轻量 Agent 和辅助生成；未配置时使用主模型。"
            control={
              <TaskModelSelect
                value={draft.values.fastModel}
                mainModel={settings.model}
                taskModelKey="fastModel"
                onChange={v => {
                  draft.setValue('fastModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="默认任务模型"
            description="用于常规 Agent、计划外的主力任务入口；未配置时使用主模型。"
            control={
              <TaskModelSelect
                value={draft.values.defaultModel}
                mainModel={settings.model}
                taskModelKey="defaultModel"
                onChange={v => {
                  draft.setValue('defaultModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="深度任务模型"
            description="用于高质量推理、复杂修改和深度审查；未配置时使用主模型。"
            control={
              <TaskModelSelect
                value={draft.values.deepModel}
                mainModel={settings.model}
                taskModelKey="deepModel"
                onChange={v => {
                  draft.setValue('deepModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="计划执行模型"
            description="批准计划后用于实施阶段；未配置时使用默认任务模型。"
            control={
              <TaskModelSelect
                value={draft.values.planExecutionModel}
                mainModel={settings.model}
                taskModelKey="planExecutionModel"
                onChange={v => {
                  draft.setValue('planExecutionModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="权限审核模型（实验）"
            description="仅用于 Shell 和工具权限的自动审核；自定义模型不兼容时会回退人工审批。"
            control={
              <TaskModelSelect
                value={draft.values.reviewModel}
                mainModel={settings.model}
                taskModelKey="reviewModel"
                onChange={v => {
                  draft.setValue('reviewModel', v)
                  draft.autoSave()
                }}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="数据位置"
          description="CodePilotX 的全局配置、会话、宠物和托管工具存储位置。"
        >
          <SettingsRow
            title="当前数据目录"
            description={
              dataLocation
                ? dataLocation.currentDataDir
                : '加载中…'
            }
            control={
              <span className="settings-row-status">
                {dataLocation
                  ? dataLocation.isEnvControlled
                    ? '环境变量控制'
                    : dataLocation.controlSource === 'bootstrap'
                      ? '自定义位置'
                      : '默认位置'
                  : '—'}
              </span>
            }
          />
          {dataLocation?.pendingDataDir ? (
            <SettingsRow
              title="待生效目录"
              description={`重启后将使用：${dataLocation.pendingDataDir}`}
              control={
                <span className="settings-row-status">等待重启</span>
              }
            />
          ) : null}
          <SettingsRow
            title="更改位置"
            description={
              dataLocation?.isEnvControlled
                ? '当前由 CODEPILOTX_DATA_DIR 控制；移除环境变量后才能通过桌面设置迁移。'
                : '选择父目录后会创建 .codepilotx，并立即重启完成安全迁移。旧目录不会删除。'
            }
            control={
              <Button
                disabled={
                  changingLocation ||
                  dataLocation?.isEnvControlled
                }
                onClick={() => void handleChooseDataLocation()}
                type="button"
              >
                {changingLocation ? '处理中…' : '选择目录'}
              </Button>
            }
          />
        </SettingsSection>

      </div>
    </SettingsContentArea>
  )
}
