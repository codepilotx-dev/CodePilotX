import React, { useEffect, useState } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import {
  Code,
  File,
  FolderOpen,
  MessagesSquare,
  SquareTerminal,
} from 'lucide-react';
import { RadioCard } from './RadioCard.js';
import { ToggleSwitch } from './ToggleSwitch.js';
import { SettingsRow } from './SettingsRow.js';
import { SettingsSection } from './SettingsSection.js';
import { SettingsDropdown } from './SettingsDropdown.js';
import { SegmentedControl } from './SegmentedControl.js';
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js';
import type {
  DesktopOpenTarget,
  DesktopPermissionMode,
} from '../../shared/types.js';

const FALLBACK_OPEN_TARGETS: DesktopOpenTarget[] = [
  {
    id: 'default-app',
    label: 'Default app',
    kind: 'default-app',
  },
  {
    id: 'file-explorer',
    label: 'File Explorer',
    kind: 'file-explorer',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    kind: 'terminal',
  },
];

const TERMINAL_SHELL_OPTIONS = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Command Prompt' },
  { value: 'bash', label: 'Bash' },
  { value: 'pwsh', label: 'PowerShell Core' },
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

const FOLLOW_UP_OPTIONS: Array<{ value: 'queue' | 'steer'; label: string }> = [
  { value: 'queue', label: '排队' },
  { value: 'steer', label: '引导' },
];

const REVIEW_OPTIONS: Array<{ value: 'inline' | 'detached'; label: string }> = [
  { value: 'inline', label: '行内视图' },
  { value: 'detached', label: '分离视图' },
];

type WorkMode = 'coding' | 'daily';

const WORK_MODES: Array<{
  value: WorkMode;
  title: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    value: 'coding',
    title: '适用于编程',
    description: '更具技术性的回复和控制',
    icon: <SquareTerminal />,
  },
  {
    value: 'daily',
    title: '适用于日常工作',
    description: '同样强大，技术细节更少',
    icon: <MessagesSquare />,
  },
];

const PERMISSION_LEVELS: Record<DesktopPermissionMode, number> = {
  default: 0,
  acceptEdits: 1,
  bypassPermissions: 2,
  dontAsk: 2,
};

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
  if (target.iconDataUrl) {
    return (
      <img
        alt=''
        className='settings-open-target-icon'
        src={target.iconDataUrl}
      />
    );
  }
  if (target.kind === 'file-explorer') {
    return <FolderOpen size={14} />;
  }
  if (target.kind === 'terminal') {
    return <SquareTerminal size={14} />;
  }
  if (target.kind === 'editor') {
    return <Code size={14} />;
  }
  return <File size={14} />;
}

export function GeneralSettings() {
  const {
    thinkingMode,
    setThinkingMode,
    permissionMode,
    setPermissionMode,
    showContextUsage,
    setShowContextUsage,
    defaultOpenTargetId,
    setDefaultOpenTargetId,
  } = useDesktopSettings();

  const [openTargets, setOpenTargets] =
    useState<DesktopOpenTarget[]>(FALLBACK_OPEN_TARGETS);
  const [openTargetsLoaded, setOpenTargetsLoaded] = useState(false);
  const [terminalShell, setTerminalShell] = useState('powershell');
  const [language, setLanguage] = useState('zh-CN');
  const [longPromptShortcut, setLongPromptShortcut] = useState(false);
  const [speed, setSpeed] = useState('standard');
  const [followUp, setFollowUp] = useState<'queue' | 'steer'>('steer');
  const [reviewView, setReviewView] = useState<'inline' | 'detached'>('inline');
  const [suggestPrompts, setSuggestPrompts] = useState(true);
  const [popupShortcut] = useState<string | null>(null);
  const [popupNoProjectChat, setPopupNoProjectChat] = useState(false);
  const [holdDictation] = useState<string | null>(null);
  const [toggleDictation] = useState<string | null>(null);
  const [notifyOnComplete, setNotifyOnComplete] = useState('unfocused');
  const [notifyPermission, setNotifyPermission] = useState(true);
  const [notifyQuestions, setNotifyQuestions] = useState(true);

  const workMode: WorkMode = thinkingMode === 'adaptive' ? 'daily' : 'coding';
  const handleWorkMode = (next: WorkMode) => {
    setThinkingMode(next === 'coding' ? 'default' : 'adaptive');
  };

  const level = PERMISSION_LEVELS[permissionMode] ?? 0;
  const defaultPermOn = level >= 0;
  const autoApproveOn = level >= 1;
  const fullAccessOn = level >= 2;

  const handleAutoApprove = (checked: boolean) => {
    if (checked) setPermissionMode('acceptEdits');
    else setPermissionMode('default');
  };
  const handleFullAccess = (checked: boolean) => {
    if (checked) setPermissionMode('bypassPermissions');
    else setPermissionMode('acceptEdits');
  };

  useEffect(() => {
    let mounted = true;
    void window.desktopApi
      .listOpenTargets()
      .then((targets) => {
        if (!mounted) return;
        const nextTargets = targets.length ? targets : FALLBACK_OPEN_TARGETS;
        setOpenTargets(nextTargets);
        setOpenTargetsLoaded(true);
        if (!nextTargets.some((target) => target.id === defaultOpenTargetId)) {
          setDefaultOpenTargetId('default-app');
        }
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

  const displayedOpenTargets =
    !openTargetsLoaded &&
    !openTargets.some((target) => target.id === defaultOpenTargetId)
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

  return (
    <div className='settings-content-area'>
      <div className='settings-content-inner'>
        <h2 className='settings-page-title'>常规</h2>

        <SettingsSection
          title='工作模式'
          description='选择 Codex 显示多少技术细节'
          bare
        >
          <RadioGroup.Root
            className='settings-radio-group'
            value={workMode}
            onValueChange={(value) => handleWorkMode(value as WorkMode)}
          >
            {WORK_MODES.map((mode) => (
              <RadioCard
                key={mode.value}
                value={mode.value}
                checked={workMode === mode.value}
                description={mode.description}
                icon={mode.icon}
                title={mode.title}
              />
            ))}
          </RadioGroup.Root>
        </SettingsSection>

        <SettingsSection title='权限'>
          <SettingsRow
            title='默认权限'
            description='默认情况下，Codex 可以读取并编辑其工作区中的文件。必要时，它可以请求额外的访问权限。'
            control={
              <ToggleSwitch
                checked={defaultPermOn}
                onChange={() => {}}
                ariaLabel='默认权限'
              />
            }
          />
          <SettingsRow
            title='自动审核'
            description={
              <>
                Codex 可以读取和编辑其工作区中的文件。Codex
                会自动审核额外访问权限请求。自动审核可能会出错。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={autoApproveOn}
                onChange={handleAutoApprove}
                ariaLabel='自动审核'
              />
            }
          />
          <SettingsRow
            title='完全访问权限'
            description={
              <>
                当 Codex
                以完全访问权限运行时，无需你批准，即可编辑你的电脑上的任何文件并运行联网命令。这会显著增加数据丢失、泄露或意外行为的风险。
                <LearnMoreLink />
              </>
            }
            control={
              <ToggleSwitch
                checked={fullAccessOn}
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
                value={terminalShell}
                options={TERMINAL_SHELL_OPTIONS}
                onChange={setTerminalShell}
                ariaLabel='集成终端 Shell'
              />
            }
          />
          <SettingsRow
            title='语言'
            description='应用 UI 语言'
            control={
              <SettingsDropdown
                value={language}
                options={LANGUAGE_OPTIONS}
                onChange={setLanguage}
                ariaLabel='语言'
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
                value={speed}
                options={SPEED_OPTIONS}
                onChange={setSpeed}
                ariaLabel='速度'
              />
            }
          />
          <SettingsRow
            title='跟进行为'
            description={
              <>
                在 Codex
                运行时将后续操作加入队列，或引导当前运行。按下'Ctrl+↵'可对单条消息执行相反操作
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
            title='代码审查'
            description='尽可能在当前对话中启动 /review，或发起单独的审查对话'
            control={
              <SegmentedControl
                value={reviewView}
                options={REVIEW_OPTIONS}
                onChange={setReviewView}
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
              <button type='button' className='settings-button'>
                导入
              </button>
            }
          />
          <SettingsRow
            title='打开源许可证'
            description='捆绑依赖项的第三方声明'
            control={
              <button type='button' className='settings-button'>
                查看
              </button>
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
                <button type='button' className='settings-button'>
                  设置
                </button>
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
            title='按住听写快捷键'
            description='在桌面任意位置按住，即可在光标处听写'
            control={
              <>
                <span className='settings-row-status'>
                  {holdDictation ? holdDictation : '关闭'}
                </span>
                <button type='button' className='settings-button'>
                  设置
                </button>
              </>
            }
          />
          <SettingsRow
            title='切换听写快捷键'
            description='在桌面任意位置按一次开始听写，再按一次停止'
            control={
              <>
                <span className='settings-row-status'>
                  {toggleDictation ? toggleDictation : '关闭'}
                </span>
                <button type='button' className='settings-button'>
                  设置
                </button>
              </>
            }
          />
          <SettingsRow
            title='听写词典'
            description='听写应能识别的单词或短语'
            control={
              <SettingsDropdown
                value=''
                options={[{ value: '', label: '未选择' }]}
                onChange={() => {}}
                ariaLabel='听写词典'
              />
            }
          />
          <SettingsRow
            title='最近的听写记录'
            description='你最近的听写记录会显示在这里，便于在文本没有出现在预期位置时找回内容'
          />
        </SettingsSection>

        <SettingsSection title='通知'>
          <SettingsRow
            title='轮次完成通知'
            description='设置 Codex 完成任务时的提醒'
            control={
              <SettingsDropdown
                value={notifyOnComplete}
                options={[
                  { value: 'always', label: '总是' },
                  { value: 'unfocused', label: '仅当应用失焦时' },
                  { value: 'never', label: '从不' },
                ]}
                onChange={setNotifyOnComplete}
                ariaLabel='轮次完成通知'
              />
            }
          />
          <SettingsRow
            title='启用权限通知'
            description='在需要通知权限时显示提醒'
            control={
              <ToggleSwitch
                checked={notifyPermission}
                onChange={setNotifyPermission}
                ariaLabel='启用权限通知'
              />
            }
          />
          <SettingsRow
            title='启用问题通知'
            description='需要输入才能继续时显示提醒'
            control={
              <ToggleSwitch
                checked={notifyQuestions}
                onChange={setNotifyQuestions}
                ariaLabel='启用问题通知'
              />
            }
          />
        </SettingsSection>

        <SettingsSection title='对话框底部栏'>
          <SettingsRow
            title='显示上下文窗口使用量'
            description='在对话框底部栏显示上下文窗口使用量'
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
    </div>
  );
}
