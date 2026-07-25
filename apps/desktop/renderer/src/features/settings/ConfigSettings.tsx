import React, { useEffect, useState } from 'react'
import { Download, RefreshCw, Trash2, Wrench } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import { PERMISSION_MODE_OPTIONS, permissionConfigForMode, permissionModeForConfig } from './settingsStorage.js'
import type { DesktopDataLocationState } from '../../../shared/types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { TaskModelSelect } from './TaskModelSelect.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import {
  SANDBOX_RUNTIME_STATUS_UNAVAILABLE,
  installSandboxRuntime,
  loadSandboxRuntimeStatus,
  refreshSandboxRuntimeStatus,
  repairSandboxRuntime,
  sandboxRuntimeStateLabel,
  uninstallSandboxRuntime,
  type SandboxRuntimeStatus,
} from '../../shared/sandboxRuntime.js'
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
  const [sandboxRuntimeStatus, setSandboxRuntimeStatus] = useState<SandboxRuntimeStatus>(SANDBOX_RUNTIME_STATUS_UNAVAILABLE)
  const [sandboxRuntimeBusy, setSandboxRuntimeBusy] = useState(false)
  const [sandboxRuntimeRefreshing, setSandboxRuntimeRefreshing] = useState(false)
  const [promptPreview, setPromptPreview] = useState<string | null>(null)

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

  useEffect(() => {
    let mounted = true
    void loadSandboxRuntimeStatus()
      .then(status => {
        if (mounted) setSandboxRuntimeStatus(status)
      })
      .catch(() => {
        if (mounted) setSandboxRuntimeStatus(SANDBOX_RUNTIME_STATUS_UNAVAILABLE)
      })
    return () => {
      mounted = false
    }
  }, [])

  const runSandboxRuntimeAction = async (action: () => Promise<SandboxRuntimeStatus>) => {
    if (sandboxRuntimeBusy || sandboxRuntimeRefreshing) return
    setSandboxRuntimeBusy(true)
    setSandboxRuntimeStatus({ ...sandboxRuntimeStatus, state: 'installing', message: '正在处理 SRT 沙箱。' })
    try {
      setSandboxRuntimeStatus(await action())
    } catch (error) {
      setSandboxRuntimeStatus({
        ...sandboxRuntimeStatus,
        state: 'needs-repair',
        message: error instanceof Error ? error.message : 'SRT 沙箱操作失败。',
        canInstall: false,
        canRepair: true,
        canUninstall: sandboxRuntimeStatus.canUninstall,
      })
    } finally {
      setSandboxRuntimeBusy(false)
    }
  }

  const refreshSandboxRuntime = async (): Promise<void> => {
    if (sandboxRuntimeBusy || sandboxRuntimeRefreshing) return
    setSandboxRuntimeRefreshing(true)
    try {
      setSandboxRuntimeStatus(await refreshSandboxRuntimeStatus())
    } catch (error) {
      setSandboxRuntimeStatus(current => ({
        ...current,
        message:
          error instanceof Error && error.message
            ? error.message
            : '无法重新扫描 SRT 沙箱状态。',
      }))
    } finally {
      setSandboxRuntimeRefreshing(false)
    }
  }

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
            配置审批策略和沙盒设置。
            <LearnMoreLink />
          </p>
        </div>

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
          title="沙盒运行环境"
          description={`SRT Windows ${sandboxRuntimeStatus.maturity.replace(/^./, value => value.toUpperCase())}，可并发运行 ${sandboxRuntimeStatus.maxConcurrentCommands} 条命令；负责隔离命令进程、文件访问和网络访问。`}
          actions={
            <Button
              disabled={sandboxRuntimeBusy || sandboxRuntimeRefreshing}
              onClick={() => void refreshSandboxRuntime()}
              title={
                sandboxRuntimeRefreshing
                  ? '正在扫描沙盒运行环境'
                  : '重新扫描'
              }
              type="button"
            >
              <RefreshCw size={APP_ICON_SIZE} />
              {sandboxRuntimeRefreshing ? '扫描中…' : '重新扫描'}
            </Button>
          }
        >
          <SettingsRow
            title="状态"
            description={sandboxRuntimeStatus.message}
            control={
              <span className="settings-row-status">
                {sandboxRuntimeStateLabel(
                  sandboxRuntimeStatus.state,
                )}
              </span>
            }
          />
          <SettingsRow
            title="安装沙盒运行环境"
            description="首次安装会请求一次 Windows 管理员权限。"
            control={
              <Button
                aria-label="安装沙盒运行环境"
                disabled={
                  sandboxRuntimeBusy ||
                  sandboxRuntimeRefreshing ||
                  !sandboxRuntimeStatus.canInstall
                }
                onClick={() => void runSandboxRuntimeAction(installSandboxRuntime)}
                type="button"
              >
                <Download size={APP_ICON_SIZE} />
                安装
              </Button>
            }
          />
          <SettingsRow
            title="修复沙盒运行环境"
            description="重新检查专用账户、helper，并将 WFP 回环端口范围更新为 60080–60095。"
            control={
              <Button
                aria-label="修复沙盒运行环境"
                disabled={
                  sandboxRuntimeBusy ||
                  sandboxRuntimeRefreshing ||
                  !sandboxRuntimeStatus.canRepair
                }
                onClick={() => void runSandboxRuntimeAction(repairSandboxRuntime)}
                type="button"
              >
                <Wrench size={APP_ICON_SIZE} />
                修复
              </Button>
            }
          />
          <SettingsRow
            title="卸载沙盒运行环境"
            description="卸载会删除专用账户和 WFP 规则，必须单独确认。"
            control={
              <Button
                aria-label="卸载沙盒运行环境"
                disabled={
                  sandboxRuntimeBusy ||
                  sandboxRuntimeRefreshing ||
                  !sandboxRuntimeStatus.canUninstall
                }
                onClick={() => {
                  if (window.confirm('确认卸载 CodePilotX SRT 沙箱吗？')) void runSandboxRuntimeAction(uninstallSandboxRuntime)
                }}
                type="button"
              >
                <Trash2 size={APP_ICON_SIZE} />
                卸载
              </Button>
            }
          />
          <SettingsRow
            title="沙盒设置"
            description="选择 CodePilotX 运行命令时可执行的操作范围。"
            control={
              <SettingsDropdown
                width={260}
                ariaLabel="沙盒设置"
                value={draft.values.permissionConfig.sandboxMode === 'read-only' ? ':read-only' : draft.values.permissionConfig.sandboxMode === 'danger-full-access' ? ':danger-full-access' : ':workspace'}
                options={[
                  { value: ':read-only', label: '只读', detail: '只能读取文件，不能修改文件' },
                  { value: ':workspace', label: '工作区写入', detail: '可以编辑文件，但仅限当前工作区' },
                  { value: ':danger-full-access', label: '完全访问', detail: '可以编辑当前工作区之外的文件' },
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
                ['sandboxApproval', 'Sandbox 提升'],
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
