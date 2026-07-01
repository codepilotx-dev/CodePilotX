import React, { useEffect, useState } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktopClient.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import { PERMISSION_MODE_OPTIONS } from './settingsStorage.js'
import type {
  DesktopRuntimeStatus,
  DesktopSandboxMode,
  DesktopToolchainDiagnosticReport,
} from '../../../shared/types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { TaskModelSelect } from './TaskModelSelect.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

const SANDBOX_MODE_OPTIONS: Array<{
  value: DesktopSandboxMode
  label: string
}> = [
  { value: 'read-only', label: '只读' },
  { value: 'workspace-write', label: '工作区写入' },
  { value: 'full-access', label: '完全访问' },
  { value: 'danger-full-access', label: '危险完全访问' },
]

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

function extractVersionLabel(status: DesktopRuntimeStatus | null): string {
  if (!status) return '—'
  const executable = status.agentExecutablePath
  const versionMatch = /codex[-_]([0-9][\w.\-]+)/i.exec(executable)
  if (versionMatch) return versionMatch[1] ?? '—'
  return '—'
}

export function ConfigSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const { draft } = settings
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(
    null,
  )
  const [toolchainReport, setToolchainReport] =
    useState<DesktopToolchainDiagnosticReport | null>(null)
  const [openingConfig, setOpeningConfig] = useState(false)
  const [diagnosingToolchain, setDiagnosingToolchain] = useState(false)
  const [reinstallingToolchain, setReinstallingToolchain] = useState(false)
  const [deletingToolchain, setDeletingToolchain] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getRuntimeStatus()
      .then(status => {
        if (mounted) setRuntimeStatus(status)
      })
      .catch(() => {
        if (mounted) setRuntimeStatus(null)
      })
    return () => {
      mounted = false
    }
  }, [])

  const refreshRuntimeStatus = async (): Promise<void> => {
    try {
      setRuntimeStatus(await desktopClient.getRuntimeStatus())
    } catch {
      setRuntimeStatus(null)
    }
  }

  const handleOpenConfigFile = async (): Promise<void> => {
    if (openingConfig) return
    setOpeningConfig(true)
    try {
      await desktopClient.openConfigFile()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`无法打开 config.toml：${message}`)
    } finally {
      setOpeningConfig(false)
    }
  }

  const handleDiagnose = async (): Promise<void> => {
    if (diagnosingToolchain) return
    setDiagnosingToolchain(true)
    try {
      const report = await desktopClient.diagnoseDesktopToolchain()
      setToolchainReport(report)
      window.alert(formatToolchainReport(report))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`诊断失败：${message}`)
    } finally {
      setDiagnosingToolchain(false)
    }
  }

  const handleReinstall = async (): Promise<void> => {
    if (reinstallingToolchain) return
    const confirmed = window.confirm(
      '将删除本地捆绑包并重新下载。确认继续吗？',
    )
    if (!confirmed) return
    setReinstallingToolchain(true)
    try {
      const result = await desktopClient.reinstallDesktopToolchain()
      setToolchainReport(result.diagnostics)
      await refreshRuntimeStatus()
      if (result.ok) {
        window.alert('重置并重新安装完成。新会话会使用更新后的工具链。')
      } else if ('error' in result) {
        window.alert(`重置并重新安装失败：${result.error}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`重置并重新安装失败：${message}`)
    } finally {
      setReinstallingToolchain(false)
    }
  }

  const handleToolchainToggle = (value: boolean): void => {
    if (!value && draft.values.installCodexDependencies) {
      setDeleteDialogOpen(true)
      return
    }
    draft.setValue('installCodexDependencies', value)
    draft.autoSave()
  }

  const handleConfirmDisableToolchain = async (): Promise<void> => {
    if (deletingToolchain) return
    setDeletingToolchain(true)
    try {
      const result = await desktopClient.deleteDesktopToolchain()
      setToolchainReport(result.diagnostics)
      if ('error' in result) {
        window.alert(`删除内置工具链失败：${result.error}`)
        return
      }
      draft.setValue('installCodexDependencies', false)
      await draft.autoSave()
      setDeleteDialogOpen(false)
      await refreshRuntimeStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`删除内置工具链失败：${message}`)
    } finally {
      setDeletingToolchain(false)
    }
  }

  const versionLabel = extractVersionLabel(runtimeStatus)

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">配置</h2>
        <p className="settings-page-desc">
          配置审批策略和沙盒设置。
          <LearnMoreLink />
        </p>

        <SettingsSection
          title="自定义 config.toml 设置"
          actions={
            <div className="settings-inline-actions">
              <SettingsDropdown
                value="user"
                ariaLabel="用户配置"
                options={[{ value: 'user', label: '用户配置' }]}
                onChange={() => {}}
              />
              <button
                className="settings-button"
                disabled={openingConfig}
                onClick={() => void handleOpenConfigFile()}
                type="button"
              >
                <Search size={APP_ICON_SIZE} />
                打开 config.toml
              </button>
            </div>
          }
        >
          <SettingsRow
            title="批准策略"
            description="选择 CodePilotX 何时请求批准"
            control={
              <SettingsDropdown
                ariaLabel="批准策略"
                value={draft.values.permissionMode}
                options={PERMISSION_MODE_OPTIONS.map(option => ({
                  value: option.value,
                  label: option.label,
                  detail: option.detail,
                }))}
                onChange={value => {
                  draft.setValue(
                    'permissionMode',
                    value as typeof draft.values.permissionMode,
                  )
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="沙盒设置"
            description="选择 CodePilotX 的命令执行权限"
            control={
              <SettingsDropdown
                ariaLabel="沙盒设置"
                value={draft.values.sandboxMode}
                options={SANDBOX_MODE_OPTIONS}
                onChange={value => {
                  draft.setValue('sandboxMode', value as DesktopSandboxMode)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="允许网络访问"
            description="当沙盒设置为工作区写入时允许网络访问"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="允许网络访问"
                checked={draft.values.allowNetworkAccess}
                onChange={value => {
                  draft.setValue('allowNetworkAccess', value)
                  draft.autoSave()
                }}
              />
            }
          />
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
            title="自动审查模型（实验）"
            description="仅用于 auto-review reviewer session；自定义模型可能因能力、格式或配置不兼容导致 auto-review 失效并回退人工审批。"
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

        <SettingsSection title="工作空间依赖项">
          <SettingsRow
            title="当前版本"
            control={
              <span className="settings-row-status settings-version-value">
                {versionLabel}
              </span>
            }
          />
          <SettingsRow
            title="CodePilotX 依赖项"
            description={`允许 CodePilotX 安装并提供随附的 Node.js 和 Python 工具。更改后对新会话生效。${
              runtimeStatus?.toolchainRoot
                ? ` 当前工具链：${runtimeStatus.toolchainRoot}`
                : ''
            }`}
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="CodePilotX 依赖项"
                checked={draft.values.installCodexDependencies}
                onChange={handleToolchainToggle}
              />
            }
          />
          <SettingsRow
            title="诊断 CodePilotX 工作空间中的问题"
            description="检查当前捆绑包并记录诊断日志"
            control={
              <button
                className="settings-button"
                disabled={diagnosingToolchain}
                onClick={() => void handleDiagnose()}
                type="button"
              >
                <Search size={APP_ICON_SIZE} />
                {diagnosingToolchain ? '诊断中' : '诊断'}
              </button>
            }
          />
          {toolchainReport ? (
            <SettingsRow
              title="最近诊断"
              description={toolchainReport.binaries
                .map(binary =>
                  `${binary.name}: ${binary.version ?? binary.path ?? 'missing'}`,
                )
                .join('；')}
              control={
                <span className="settings-row-status">
                  {toolchainReport.enabled ? '已启用' : '已禁用'}
                </span>
              }
            />
          ) : null}
          <SettingsRow
            title="重置并安装工作空间"
            description="删除本地捆绑包，重新下载后重新加载工具"
            control={
              <button
                className="settings-button"
                disabled={reinstallingToolchain}
                onClick={() => void handleReinstall()}
                type="button"
              >
                <RotateCcw size={APP_ICON_SIZE} />
                {reinstallingToolchain ? '安装中' : '重新安装'}
              </button>
            }
          />
        </SettingsSection>
      </div>
      <ConfirmationDialog
        open={deleteDialogOpen}
        title="关闭 CodePilotX 依赖项？"
        description="关闭后会删除用户数据目录中已安装的内置 Node.js / Python 工具链文件。安装包随附的只读工具链不会被删除；新会话将只使用项目本地工具和系统 PATH。"
        cancelLabel="取消"
        actionLabel={deletingToolchain ? '删除中' : '确认关闭并删除'}
        tone="danger"
        actionDisabled={deletingToolchain}
        onCancel={() => {
          if (!deletingToolchain) setDeleteDialogOpen(false)
        }}
        onAction={() => void handleConfirmDisableToolchain()}
      />
    </SettingsContentArea>
  )
}

function formatToolchainReport(report: DesktopToolchainDiagnosticReport): string {
  const lines = [
    `工具链：${report.enabled ? '已启用' : '已禁用'}`,
    `根目录：${report.root ?? '未找到'}`,
    ...report.binaries.map(binary => {
      const target = binary.targetVersion ? ` target ${binary.targetVersion}` : ''
      const version = binary.version ? ` (${binary.version})` : ''
      const error = binary.error ? ` - ${binary.error}` : ''
      return `${binary.name}: ${binary.source} ${binary.path ?? 'missing'}${target}${version}${error}`
    }),
  ]
  if (report.logPath) {
    lines.push(`日志：${report.logPath}`)
  }
  return lines.join('\n')
}
