import React, { useState } from 'react'
import { Code2, Briefcase } from 'lucide-react'
import { RadioCard } from './RadioCard.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SegmentedControl } from './SegmentedControl.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import type { DesktopPermissionMode } from '../../shared/types.js'

const OPEN_TARGET_OPTIONS = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'finder', label: '文件资源管理器' },
  { value: 'terminal', label: '终端' },
]

const TERMINAL_SHELL_OPTIONS = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Command Prompt' },
  { value: 'bash', label: 'Bash' },
  { value: 'pwsh', label: 'PowerShell Core' },
]

const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '中文（中国）' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
]

const SPEED_OPTIONS = [
  { value: 'fast', label: '快' },
  { value: 'standard', label: '标准' },
  { value: 'thorough', label: '深入' },
]

const FOLLOW_UP_OPTIONS: Array<{ value: 'queue' | 'steer'; label: string }> = [
  { value: 'queue', label: '排队' },
  { value: 'steer', label: '引导' },
]

const REVIEW_OPTIONS: Array<{ value: 'inline' | 'detached'; label: string }> = [
  { value: 'inline', label: '行内视图' },
  { value: 'detached', label: '分离视图' },
]

type WorkMode = 'coding' | 'daily'

const WORK_MODES: Array<{
  value: WorkMode
  title: string
  description: string
  icon: React.ReactNode
}> = [
  {
    value: 'coding',
    title: '适用于编程',
    description: '更具技术性的回复和控制',
    icon: <Code2 />,
  },
  {
    value: 'daily',
    title: '适用于日常工作',
    description: '同样强大，技术细节更少',
    icon: <Briefcase />,
  },
]

const PERMISSION_LEVELS: Record<DesktopPermissionMode, number> = {
  default: 0,
  acceptEdits: 1,
  bypassPermissions: 2,
  dontAsk: 2,
}

function LearnMoreLink() {
  return (
    <a
      className="settings-row-link"
      href="#"
      onClick={e => e.preventDefault()}
    >
      了解更多有关高风险的信息。
    </a>
  )
}

export function GeneralSettings() {
  const { thinkingMode, setThinkingMode, permissionMode, setPermissionMode } =
    useDesktopSettings()

  const [openTarget, setOpenTarget] = useState('vscode')
  const [terminalShell, setTerminalShell] = useState('powershell')
  const [language, setLanguage] = useState('zh-CN')
  const [longPromptShortcut, setLongPromptShortcut] = useState(false)
  const [speed, setSpeed] = useState('standard')
  const [followUp, setFollowUp] = useState<'queue' | 'steer'>('steer')
  const [reviewView, setReviewView] = useState<'inline' | 'detached'>('inline')
  const [suggestPrompts, setSuggestPrompts] = useState(true)
  const [popupShortcut] = useState<string | null>(null)
  const [popupNoProjectChat, setPopupNoProjectChat] = useState(false)

  const workMode: WorkMode = thinkingMode === 'adaptive' ? 'daily' : 'coding'
  const handleWorkMode = (next: WorkMode) => {
    setThinkingMode(next === 'coding' ? 'default' : 'adaptive')
  }

  const level = PERMISSION_LEVELS[permissionMode] ?? 0
  const defaultPermOn = level >= 0
  const autoApproveOn = level >= 1
  const fullAccessOn = level >= 2

  const handleAutoApprove = (checked: boolean) => {
    if (checked) setPermissionMode('acceptEdits')
    else setPermissionMode('default')
  }
  const handleFullAccess = (checked: boolean) => {
    if (checked) setPermissionMode('bypassPermissions')
    else setPermissionMode('acceptEdits')
  }

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">常规</h2>

        <section className="settings-section">
          <div className="settings-section-header">
            <h3 className="settings-section-title">工作模式</h3>
            <p className="settings-section-desc">选择 Codex 显示多少技术细节</p>
          </div>
          <div className="settings-radio-group">
            {WORK_MODES.map(mode => (
              <RadioCard
                key={mode.value}
                checked={workMode === mode.value}
                description={mode.description}
                icon={mode.icon}
                onClick={() => handleWorkMode(mode.value)}
                title={mode.title}
              />
            ))}
          </div>
        </section>

        <SettingsSection title="权限">
          <SettingsRow
            title="默认权限"
            description="默认情况下，Codex 可以读取并编辑其工作区中的文件。必要时，它可以请求额外的访问权限。"
            control={
              <ToggleSwitch
                checked={defaultPermOn}
                onChange={() => {}}
                ariaLabel="默认权限"
              />
            }
          />
          <SettingsRow
            title="自动审核"
            description={
              <>
                Codex 可以读取和编辑其工作区中的文件。Codex 会自动审核额外访问权限请求。自动审核可能会出错。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={autoApproveOn}
                onChange={handleAutoApprove}
                ariaLabel="自动审核"
              />
            }
          />
          <SettingsRow
            title="完全访问权限"
            description={
              <>
                当 Codex 以完全访问权限运行时，无需你批准，即可编辑你的电脑上的任何文件并运行联网命令。这会显著增加数据丢失、泄露或意外行为的风险。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={fullAccessOn}
                onChange={handleFullAccess}
                ariaLabel="完全访问权限"
              />
            }
          />
        </SettingsSection>

        <SettingsSection title="常规">
          <SettingsRow
            title="默认打开目标"
            description="默认打开文件和文件夹的位置"
            control={
              <SettingsDropdown
                value={openTarget}
                options={OPEN_TARGET_OPTIONS}
                onChange={setOpenTarget}
                ariaLabel="默认打开目标"
              />
            }
          />
          <SettingsRow
            title="集成终端 Shell"
            description="选择要在集成终端中打开的 Shell。"
            control={
              <SettingsDropdown
                value={terminalShell}
                options={TERMINAL_SHELL_OPTIONS}
                onChange={setTerminalShell}
                ariaLabel="集成终端 Shell"
              />
            }
          />
          <SettingsRow
            title="语言"
            description="应用 UI 语言"
            control={
              <SettingsDropdown
                value={language}
                options={LANGUAGE_OPTIONS}
                onChange={setLanguage}
                ariaLabel="语言"
              />
            }
          />
          <SettingsRow
            title="需按 ^ + 回车键发送长文本提示"
            description="启用后，长文本提示需按 ^ + 回车键发送。"
            control={
              <ToggleSwitch
                checked={longPromptShortcut}
                onChange={setLongPromptShortcut}
                ariaLabel="需按快捷键发送长文本提示"
              />
            }
          />
          <SettingsRow
            title="速度"
            description="选择用于聊天、子智能体和压缩的推理层级"
            control={
              <SettingsDropdown
                value={speed}
                options={SPEED_OPTIONS}
                onChange={setSpeed}
                ariaLabel="速度"
              />
            }
          />
          <SettingsRow
            title="跟进行为"
            description={
              <>
                在 Codex 运行时将后续操作加入队列，或引导当前运行。按下"Ctrl+↵"可对单条消息执行相反操作
              </>
            }
            control={
              <SegmentedControl
                value={followUp}
                options={FOLLOW_UP_OPTIONS}
                onChange={setFollowUp}
              />
            }
          />
          <SettingsRow
            title="代码审查"
            description="尽可能在当前对话中启动 /review，或发起单独的审查对话"
            control={
              <SegmentedControl
                value={reviewView}
                options={REVIEW_OPTIONS}
                onChange={setReviewView}
              />
            }
          />
          <SettingsRow
            title="建议提示"
            description="搜索项目文件和已连接应用，建议下一步操作"
            control={
              <ToggleSwitch
                checked={suggestPrompts}
                onChange={setSuggestPrompts}
                ariaLabel="建议提示"
              />
            }
          />
          <SettingsRow
            title="从其他 AI 应用导入工作内容"
            description="导入您的设置、项目和最近聊天记录"
            control={
              <button type="button" className="settings-button">
                导入
              </button>
            }
          />
          <SettingsRow
            title="打开源许可证"
            description="捆绑依赖项的第三方声明"
            control={
              <button type="button" className="settings-button">
                查看
              </button>
            }
          />
        </SettingsSection>

        <SettingsSection title="弹出窗口">
          <SettingsRow
            title="弹出窗口快捷键"
            description="为弹出窗口设置全局快捷键。留空则保持关闭。"
            control={
              <>
                <span className="settings-row-status">
                  {popupShortcut ? popupShortcut : '禁用'}
                </span>
                <button type="button" className="settings-button">
                  设置
                </button>
              </>
            }
          />
          <SettingsRow
            title="默认使用无项目聊天"
            description="无需项目即可开始新聊天"
            control={
              <ToggleSwitch
                checked={popupNoProjectChat}
                onChange={setPopupNoProjectChat}
                ariaLabel="默认使用无项目聊天"
              />
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}
