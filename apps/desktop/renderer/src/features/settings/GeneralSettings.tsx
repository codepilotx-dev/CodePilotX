import {
  desktopClient,
  loadDesktopTerminalClient,
} from '../../services/desktop-client/index.js'
import React, { useCallback, useEffect, useState } from 'react';
import { OpenTargetIcon } from '../../components/ui/openTargetIcon.js';
import {
  OPEN_TARGET_STORED_SENTINELS,
} from '../../services/desktop-client/openTargetSelection.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js';
import { SettingsRow } from './SettingsRow.js';
import { SettingsSection } from './SettingsSection.js';
import { SettingsDropdown } from './SettingsDropdown.js';
import { SegmentedControl } from './SegmentedControl.js';
import { useDesktopSettings } from './useDesktopSettings.js';
import { SettingsContentArea } from './SettingsContentArea.js';
import { permissionConfigForMode, permissionModeForConfig } from './settingsStorage.js'
import type {
  DesktopOpenTarget,
  DesktopReviewDelivery,
  DesktopReviewView,
} from '../../../shared/types.js';
import { Button } from '../../components/ui/Button.js'
import type { DesktopTerminalProfile } from '@codepilotx/shared/desktop-terminal-ipc'
import { useSpeechStatus } from '../speech/useSpeechStatus.js'

const FALLBACK_OPEN_TARGETS: DesktopOpenTarget[] = [
  {
    id: 'file-explorer',
    label: 'File Explorer',
    kind: 'file-explorer',
  },
];

const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '中文（中国）' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
];

const SPEED_OPTIONS = [
  { value: 'fast', label: '快' },
  { value: 'standard', label: '标准' },
  { value: 'thorough', label: '深入' },
];

const REVIEW_OPTIONS: Array<{ value: DesktopReviewView; label: string }> = [
  { value: 'inline', label: '行内视图' },
  { value: 'split', label: '分离视图' },
];
const REVIEW_DELIVERY_OPTIONS: Array<{
  value: DesktopReviewDelivery;
  label: string;
}> = [
  { value: 'inline', label: '当前任务' },
  { value: 'detached', label: '独立任务' },
];

function speechStatusLabel(
  status: import('../../services/desktop-client/index.js').DesktopSpeechStatus | null,
  loading: boolean,
): string {
  if (loading && !status) return '检查中…'
  if (!status) return '不可用'
  if (status.state === 'unsupported') return '不支持'
  if (status.state === 'not-installed') return '未安装'
  if (status.state === 'downloading') return '下载中'
  if (status.state === 'installing') return '安装中'
  if (status.state === 'ready') return '已就绪'
  if (status.state === 'transcribing') return '转写中'
  return '出错'
}

function speechStatusDescription(
  status: import('../../services/desktop-client/index.js').DesktopSpeechStatus | null,
  error: string | null,
): string {
  const message = status?.error?.message ?? error
  if (message) return message
  const progress = status?.progress
  if (progress) {
    if (progress.totalBytes) {
      return `SenseVoice 本地运行时 · ${Math.round(progress.receivedBytes / progress.totalBytes * 100)}%`
    }
    return `SenseVoice 本地运行时 · 已接收 ${Math.round(progress.receivedBytes / 1_048_576)} MB`
  }
  return 'SenseVoice Small 在本机离线转写，音频不会发送到云端。'
}

function LearnMoreLink() {
  return (
    <a
      className='settings-row-link'
      href='#'
      onClick={(e) => e.preventDefault()}
    >
      了解更多有关高风险的信息。
    </a>
  );
}

function renderOpenTargetIcon(target: DesktopOpenTarget): React.ReactNode {
  return (
    <OpenTargetIcon
      className='settings-open-target-icon'
      kind={target.kind}
      targetId={target.id}
    />
  );
}

type GeneralSettingsProps = {
  onNotice?: (message: string) => void
}

export function GeneralSettings({
  onNotice,
}: GeneralSettingsProps = {}) {
  const {
    draft,
  } = useDesktopSettings();
  const {
    permissionConfig,
    enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode,
    showContextUsage,
    defaultOpenTargetId,
    terminalProfileId,
    reviewView,
    reviewDelivery,
    rustSearchAndDiffKernels,
    enableParetoCodeRouter,
    enableFusionRouter,
    defaultModeRequestUserInput,
    notifications,
  } = draft.values;
  const preferredInputDeviceId =
    draft.values['desktop.voice.preferredInputDeviceId']
  const speech = useSpeechStatus()
  const permissionMode = permissionModeForConfig(permissionConfig)

  const [openTargets, setOpenTargets] =
    useState<DesktopOpenTarget[]>(FALLBACK_OPEN_TARGETS);
  const [openTargetsLoaded, setOpenTargetsLoaded] = useState(false);
  const [terminalProfiles, setTerminalProfiles] = useState<
    readonly DesktopTerminalProfile[]
  >([])
  const [terminalProfilesLoaded, setTerminalProfilesLoaded] = useState(false)
  const [language, setLanguage] = useState('zh-CN');
  const [longPromptShortcut, setLongPromptShortcut] = useState(false);
  const [speed, setSpeed] = useState('standard');
  const [suggestPrompts, setSuggestPrompts] = useState(true);
  const [popupShortcut] = useState<string | null>(null);
  const [popupNoProjectChat, setPopupNoProjectChat] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioInputs(devices.filter(device => device.kind === 'audioinput'))
  }, [])
  useEffect(() => {
    void refreshAudioInputs().catch(() => {})
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioInputs)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshAudioInputs)
    }
  }, [refreshAudioInputs])
  const setPreferredInputDeviceId = useCallback((value: string) => {
    draft.setValue('desktop.voice.preferredInputDeviceId', value)
    draft.autoSave()
  }, [draft])
  const setCompletionNotification = useCallback(
    (value: 'always' | 'unfocused' | 'never') => {
      draft.setValue('notifications', {
        ...draft.values.notifications,
        completion: value,
      })
      draft.autoSave()
    },
    [draft],
  )
  const setPermissionNotifications = useCallback(
    (value: boolean) => {
      draft.setValue('notifications', {
        ...draft.values.notifications,
        permissions: value,
      })
      draft.autoSave()
    },
    [draft],
  )
  const setQuestionNotifications = useCallback(
    (value: boolean) => {
      draft.setValue('notifications', {
        ...draft.values.notifications,
        questions: value,
      })
      draft.autoSave()
    },
    [draft],
  )
  const setErrorNotifications = useCallback(
    (value: boolean) => {
      draft.setValue('notifications', {
        ...draft.values.notifications,
        errors: value,
      })
      draft.autoSave()
    },
    [draft],
  )
  const setShowContextUsage = useCallback(
    (value: boolean) => {
      draft.setValue('showContextUsage', value)
      draft.autoSave()
    },
    [draft],
  )
  const setDefaultOpenTargetId = useCallback(
    (value: string) => {
      draft.setValue('defaultOpenTargetId', value)
      draft.autoSave()
    },
    [draft],
  )
  const setTerminalProfileId = useCallback(
    (value: string) => {
      draft.setValue('terminalProfileId', value === 'auto' ? null : value)
      draft.autoSave()
    },
    [draft],
  )
  const setReviewView = useCallback(
    (value: DesktopReviewView) => {
      draft.setValue('reviewView', value)
      draft.autoSave()
    },
    [draft],
  )
  const setReviewDelivery = useCallback(
    (value: DesktopReviewDelivery) => {
      draft.setValue('reviewDelivery', value)
      draft.autoSave()
    },
    [draft],
  )
  const setRustSearchAndDiffKernels = useCallback(
    (value: boolean) => {
      draft.setValue('rustSearchAndDiffKernels', value)
      draft.autoSave()
    },
    [draft],
  )
  const setEnableParetoCodeRouter = useCallback(
    (value: boolean) => {
      draft.setValue('enableParetoCodeRouter', value)
      draft.autoSave()
    },
    [draft],
  )
  const setEnableFusionRouter = useCallback(
    (value: boolean) => {
      draft.setValue('enableFusionRouter', value)
      draft.autoSave()
    },
    [draft],
  )
  const setDefaultModeRequestUserInput = useCallback(
    (value: boolean) => {
      draft.setValue('defaultModeRequestUserInput', value)
      draft.autoSave()
    },
    [draft],
  )

  const handleAutoApprove = (checked: boolean) => {
    draft.setValue('enableAutoReviewPermissionMode', checked);
    if (!checked && permissionMode === 'auto-review') {
      draft.setValue('permissionConfig', permissionConfigForMode('default'))
    }
    draft.autoSave();
  };
  const handleFullAccess = (checked: boolean) => {
    draft.setValue('enableFullAccessPermissionMode', checked);
    if (!checked && permissionMode === 'full-access') {
      draft.setValue('permissionConfig', permissionConfigForMode('default'))
    }
    draft.autoSave();
  };

  useEffect(() => {
    let mounted = true;
    void desktopClient
      .listOpenTargets()
      .then((targets) => {
        if (!mounted) return;
        const nextTargets = targets.length ? targets : FALLBACK_OPEN_TARGETS;
        setOpenTargets(nextTargets);
        setOpenTargetsLoaded(true);
      })
      .catch(() => {
        if (mounted) {
          setOpenTargets(FALLBACK_OPEN_TARGETS);
          setOpenTargetsLoaded(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [defaultOpenTargetId, setDefaultOpenTargetId]);

  useEffect(() => {
    let mounted = true
    void loadDesktopTerminalClient()
      .then(client => client.listTerminalProfiles())
      .then(profiles => {
        if (!mounted) return
        setTerminalProfiles(profiles)
        setTerminalProfilesLoaded(true)
      })
      .catch(() => {
        if (!mounted) return
        setTerminalProfiles([])
        setTerminalProfilesLoaded(true)
      })
    return () => {
      mounted = false
    }
  }, [])

  const displayedOpenTargets =
    !openTargetsLoaded &&
    !openTargets.some((target) => target.id === defaultOpenTargetId) &&
    !(OPEN_TARGET_STORED_SENTINELS as readonly string[]).includes(
      defaultOpenTargetId,
    )
      ? [
          ...openTargets,
          {
            id: defaultOpenTargetId,
            label: 'Loading...',
            kind: 'editor' as const,
          },
        ]
      : openTargets;

  const openTargetOptions = displayedOpenTargets.map((target) => ({
    value: target.id,
    label: target.label,
    icon: renderOpenTargetIcon(target),
  }));
  const terminalProfileOptions = [
    { value: 'auto', label: '自动检测' },
    ...terminalProfiles.map(profile => ({
      value: profile.id,
      label: profile.isDefault ? `${profile.label}（默认）` : profile.label,
      disabled: !profile.available,
    })),
    ...(terminalProfileId &&
    !terminalProfiles.some(profile => profile.id === terminalProfileId)
      ? [{
          value: terminalProfileId,
          label: terminalProfilesLoaded ? '已保存的 Shell（当前不可用）' : '正在加载…',
          disabled: true,
        }]
      : []),
  ]
  return (
    <SettingsContentArea className="">
      <div className='settings-content-inner'>
        <div className="settings-page-header">
          <h2 className='settings-page-title'>常规</h2>
        </div>

        <SettingsSection title='权限'>
          <SettingsRow
            title='默认权限'
            description='默认情况下，CodePilotX 可以自动读取工作区内容；写入文件、运行命令、联网和 MCP 请求需要你授权。'
            autoSave
            control={
              <ToggleSwitch
                checked
                disabled
                onChange={() => {}}
                ariaLabel='默认权限'
              />
            }
          />
          <SettingsRow
            title='自动审核'
            autoSave
            description={
              <>
                CodePilotX 可以读取和编辑其工作区中的文件。CodePilotX
                会自动审核额外访问权限请求。自动审核可能会出错。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={enableAutoReviewPermissionMode ?? false}
                onChange={handleAutoApprove}
                ariaLabel='自动审核'
              />
            }
          />
          <SettingsRow
            title='完全访问权限'
            autoSave
            description={
              <>
                当 CodePilotX
                以完全访问权限运行时，无需你批准，即可自动放行所有权限工具，编辑你的电脑上的任何文件并运行联网命令。这会显著增加数据丢失、泄露或意外行为的风险。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={enableFullAccessPermissionMode ?? false}
                onChange={handleFullAccess}
                ariaLabel='完全访问权限'
              />
            }
          />
        </SettingsSection>

        <SettingsSection title='常规'>
          <SettingsRow
            title='默认打开目标'
            description='默认打开文件和文件夹的位置'
            control={
              <SettingsDropdown
                width={220}
                value={defaultOpenTargetId}
                options={openTargetOptions}
                onChange={setDefaultOpenTargetId}
                ariaLabel='默认打开目标'
              />
            }
          />
          <SettingsRow
            title='集成终端 Shell'
            description='选择要在集成终端中打开的 Shell。'
            control={
              <SettingsDropdown
                width={220}
                value={terminalProfileId ?? 'auto'}
                options={terminalProfileOptions}
                onChange={setTerminalProfileId}
                ariaLabel='集成终端 Shell'
              />
            }
          />
          <SettingsRow
            title='语言'
            description='应用 UI 语言'
            control={
              <SettingsDropdown
                width={240}
                value={language}
                options={LANGUAGE_OPTIONS}
                onChange={setLanguage}
                ariaLabel='语言'
                searchable
                searchPlaceholder='搜索语言'
              />
            }
          />
          <SettingsRow
            title='需按 ^ + 回车键发送长文本提示'
            description='启用后，长文本提示需按 ^ + 回车键发送。'
            control={
              <ToggleSwitch
                checked={longPromptShortcut}
                onChange={setLongPromptShortcut}
                ariaLabel='需按快捷键发送长文本提示'
              />
            }
          />
          <SettingsRow
            title='速度'
            description='选择用于聊天、子智能体和压缩的推理层级'
            control={
              <SettingsDropdown
                width={260}
                value={speed}
                options={SPEED_OPTIONS}
                onChange={setSpeed}
                ariaLabel='速度'
              />
            }
          />
          <SettingsRow
            title='允许普通模式提问'
            description='开启后，主 Agent 可在普通模式中通过结构化问题卡向你提问。计划模式始终允许。'
            autoSave
            control={
              <ToggleSwitch
                checked={defaultModeRequestUserInput}
                onChange={setDefaultModeRequestUserInput}
                ariaLabel='允许普通模式提问'
              />
            }
          />
          <SettingsRow
            title='代码审查'
            description='审阅侧栏中 diff 的展示方式：行内视图（叠加显示）或分离视图（左右对照）'
            autoSave
            control={
              <SegmentedControl
                value={reviewView}
                options={REVIEW_OPTIONS}
                variant='inset'
                onChange={setReviewView}
              />
            }
          />
          <SettingsRow
            title='AI 审查结果'
            description='在当前任务继续审查，或为每次 AI Review 创建独立任务'
            autoSave
            control={
              <SegmentedControl
                value={reviewDelivery}
                options={REVIEW_DELIVERY_OPTIONS}
                variant='inset'
                onChange={setReviewDelivery}
              />
            }
          />
          <SettingsRow
            title='建议提示'
            description='搜索项目文件和已连接应用，建议下一步操作'
            control={
              <ToggleSwitch
                checked={suggestPrompts}
                onChange={setSuggestPrompts}
                ariaLabel='建议提示'
              />
            }
          />
          <SettingsRow
            title='从其他 AI 应用导入工作内容'
            description='导入您的设置、项目和最近聊天记录'
            control={
              <Button color="primary" type='button'>
                导入
              </Button>
            }
          />
          <SettingsRow
            title='打开源许可证'
            description='捆绑依赖项的第三方声明'
            control={
              <Button color="secondary" type='button'>
                查看
              </Button>
            }
          />
        </SettingsSection>

        <SettingsSection
          title='实现性'
          description='这些底层能力通过 Rust sidecar 提供。Rust sidecar 已作为默认 agent 运行时。'
        >
          <SettingsRow
            title='Rust Glob / Grep / Diff 内核'
            description='启用后，Rust sidecar 将执行文件遍历、内容搜索和 diff 计算，不再回退到 TS 路径。'
            autoSave
            control={
              <ToggleSwitch
                checked={rustSearchAndDiffKernels}
                onChange={checked => {
                  setRustSearchAndDiffKernels(checked)
                }}
                ariaLabel='Rust Glob Grep Diff 内核'
              />
            }
          />
        </SettingsSection>



        <SettingsSection title='弹出窗口'>
          <SettingsRow
            title='弹出窗口快捷键'
            description='为弹出窗口设置全局快捷键。留空则保持关闭。'
            control={
              <>
                <span className='settings-row-status'>
                  {popupShortcut ? popupShortcut : '禁用'}
                </span>
                <Button color="secondary" type='button'>
                  设置
                </Button>
              </>
            }
          />
          <SettingsRow
            title='默认使用无项目聊天'
            description='无需项目即可开始新聊天'
            control={
              <ToggleSwitch
                checked={popupNoProjectChat}
                onChange={setPopupNoProjectChat}
                ariaLabel='默认使用无项目聊天'
              />
            }
          />
        </SettingsSection>

        <SettingsSection title='听写'>
          <SettingsRow
            title='本地语音模型'
            description={speechStatusDescription(speech.status, speech.error)}
            control={
              <>
                <span className='settings-row-status'>
                  {speechStatusLabel(speech.status, speech.loading)}
                </span>
                {speech.status?.state === 'error' || speech.status?.state === 'not-installed' ? (
                  <Button
                    disabled={speech.loading}
                    onClick={() => void speech.install(true)}
                    type='button'
                  >
                    重试
                  </Button>
                ) : null}
              </>
            }
          />
          <SettingsRow
            title='输入设备'
            description='录音时优先使用的麦克风；不可用时自动回退到系统默认设备。'
            control={
              <SettingsDropdown
                width={260}
                value={preferredInputDeviceId}
                options={[
                  { value: '', label: '系统默认麦克风' },
                  ...audioInputs.map((device, index) => ({
                    value: device.deviceId,
                    label: device.label || `麦克风 ${index + 1}`,
                  })),
                ]}
                onChange={setPreferredInputDeviceId}
                ariaLabel='听写输入设备'
              />
            }
          />
          <SettingsRow
            title='听写快捷键'
            description='在当前消息输入框中开始或停止听写。'
            control={
              <span className='settings-row-status'>Ctrl+Shift+D</span>
            }
          />
          <SettingsRow
            title='麦克风隐私设置'
            description='打开 Windows 麦克风权限页面，允许 CodePilotX 使用输入设备。'
            control={
              <Button
                onClick={() => {
                  void desktopClient.openMicrophonePrivacySettings().catch(error => {
                    onNotice?.(error instanceof Error ? error.message : String(error))
                  })
                }}
                type='button'
              >
                打开设置
              </Button>
            }
          />
        </SettingsSection>

        <SettingsSection title='通知'>
          <SettingsRow
            title='轮次完成通知'
            description='设置 CodePilotX 完成任务时是否显示系统通知'
            control={
              <SettingsDropdown
                width={260}
                value={notifications.completion}
                options={[
                  { value: 'always', label: '总是' },
                  { value: 'unfocused', label: '仅当应用失焦时' },
                  { value: 'never', label: '从不' },
                ]}
                onChange={setCompletionNotification}
                ariaLabel='轮次完成通知'
              />
            }
          />
          <SettingsRow
            title='启用权限通知'
            description='在需要额外权限时显示系统通知'
            control={
              <ToggleSwitch
                checked={notifications.permissions}
                onChange={setPermissionNotifications}
                ariaLabel='启用权限通知'
              />
            }
          />
          <SettingsRow
            title='启用问题通知'
            description='需要输入才能继续时显示系统通知'
            control={
              <ToggleSwitch
                checked={notifications.questions}
                onChange={setQuestionNotifications}
                ariaLabel='启用问题通知'
              />
            }
          />
          <SettingsRow
            title='启用任务错误通知'
            description='任务执行失败时显示系统通知'
            control={
              <ToggleSwitch
                checked={notifications.errors}
                onChange={setErrorNotifications}
                ariaLabel='启用任务错误通知'
              />
            }
          />
        </SettingsSection>

        <SettingsSection title='对话框底部栏'>
          <SettingsRow
            title='显示上下文窗口使用量'
            description='在对话框底部栏显示上下文窗口使用量'
            autoSave
            control={
              <ToggleSwitch
                checked={showContextUsage}
                onChange={setShowContextUsage}
                ariaLabel='显示上下文窗口使用量'
              />
            }
          />
        </SettingsSection>
      </div>
    </SettingsContentArea>
  );
}
