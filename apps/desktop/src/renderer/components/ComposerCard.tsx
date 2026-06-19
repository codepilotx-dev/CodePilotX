import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Select from '@radix-ui/react-select'
import {
  ArrowUp,
  Blocks,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  FileSpreadsheet,
  GitBranch,
  Hand,
  ListChecks,
  Mic,
  Monitor,
  Paperclip,
  Plus,
  Presentation,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  Target,
  Wrench,
  Zap,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './ui/iconTokens.js'
import type {
  DesktopPermissionMode,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopWorkspace,
  DesktopContextUsage,
  ModelProviderID,
} from '../../shared/types.js'
import type { ModelPreset } from '../modelPresets.js'
import { CUSTOM_MODEL_PRESET_ID } from '../modelPresets.js'
import { ChipButton } from './ui/ChipButton.js'
import { IconButton } from './ui/IconButton.js'
import { MetaChip } from './ui/MetaChip.js'
import { PopoverItem } from './ui/PopoverItem.js'
import { PopoverMenu } from './ui/PopoverMenu.js'
import { SearchInput } from './ui/SearchInput.js'

type Option<T extends string> = {
  value: T
  label: string
  detail?: string
}

type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
}

type ComposerDropdown =
  | 'context'
  | 'permission'
  | 'model'
  | 'project'
  | 'mode'
  | 'branch'

type ContextPlugin = {
  name: string
  tone: 'docs' | 'pdf' | 'sheets' | 'slides' | 'github' | 'openai'
  icon: React.ReactNode
}

const INSTALLED_CONTEXT_PLUGINS: ContextPlugin[] = [
  {
    name: 'Documents',
    tone: 'docs',
    icon: <FileText size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: 'PDF',
    tone: 'pdf',
    icon: <FileText size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: 'Spreadsheets',
    tone: 'sheets',
    icon: <FileSpreadsheet size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: 'Presentations',
    tone: 'slides',
    icon: <Presentation size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: 'GitHub',
    tone: 'github',
    icon: <GitBranch size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: 'OpenAI Developers',
    tone: 'openai',
    icon: <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
]

type Props = {
  input: string
  canSubmit: boolean
  sessionStatus: DesktopSessionStatus
  permissionMode: DesktopPermissionMode
  thinkingMode: DesktopThinkingMode
  selectedProviderID: ModelProviderID
  selectedModelPreset: string
  showThinkingOptions: boolean
  deepSeekThinkingControls: boolean
  showContextUsage: boolean
  contextUsage: DesktopContextUsage | null
  modelPresets: ModelPreset[]
  providerOptions: ProviderModelOption[]
  permissionOptions: Option<DesktopPermissionMode>[]
  thinkingOptions: Option<DesktopThinkingMode>[]
  branchName: string
  branches: string[]
  recentWorkspaces: DesktopWorkspace[]
  workspace: DesktopWorkspace | null
  placeholder?: string
  onChooseWorkspace: () => void
  onInputChange: (value: string) => void
  onInterrupt: () => void
  onProviderModelChange: (
    providerID: ModelProviderID,
    modelPresetID: string,
  ) => void
  onOpenFiles: () => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => void
  onBranchSelect: (branch: string) => void
  onCreateBranch: () => void
  onPermissionChange: (value: DesktopPermissionMode) => void
  onSubmit: () => void
  onThinkingChange: (value: DesktopThinkingMode) => void
}

export function ComposerCard({
  input,
  canSubmit,
  sessionStatus,
  permissionMode,
  thinkingMode,
  selectedProviderID,
  selectedModelPreset,
  showThinkingOptions,
  deepSeekThinkingControls,
  showContextUsage,
  contextUsage,
  modelPresets,
  providerOptions,
  permissionOptions,
  thinkingOptions,
  branchName,
  branches,
  recentWorkspaces,
  workspace,
  placeholder = '随心输入',
  onChooseWorkspace,
  onInputChange,
  onInterrupt,
  onProviderModelChange,
  onOpenFiles,
  onOpenWorkspace,
  onBranchSelect,
  onCreateBranch,
  onPermissionChange,
  onSubmit,
  onThinkingChange,
}: Props): React.ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [openDropdown, setOpenDropdown] = useState<ComposerDropdown | null>(
    null,
  )
  const [projectSearch, setProjectSearch] = useState('')
  const [branchSearch, setBranchSearch] = useState('')
  const [planModeEnabled, setPlanModeEnabled] = useState(false)
  const [goalModeEnabled, setGoalModeEnabled] = useState(false)

  const selectedPermission = permissionOptions.find(
    option => option.value === permissionMode,
  )
  const selectedModel = modelPresets.find(
    preset => preset.id === selectedModelPreset,
  )
  const selectedProvider = providerOptions.find(
    provider => provider.providerID === selectedProviderID,
  )
  const selectedModelLabel =
    selectedModelPreset === CUSTOM_MODEL_PRESET_ID
      ? '自定义模型'
      : (selectedModel?.shortLabel ?? selectedModel?.label ?? selectedModelPreset)
  const selectedModelTitle =
    selectedModelPreset === CUSTOM_MODEL_PRESET_ID
      ? '自定义模型'
      : (selectedModel?.label ?? selectedModelPreset)
  const selectedThinking = thinkingOptions.find(
    option => option.value === thinkingMode,
  )
  const selectedThinkingLabel = deepSeekThinkingControls
    ? thinkingMode === 'disabled'
      ? '思考关闭'
      : thinkingMode === 'enabled'
        ? '超高'
        : '高'
    : (selectedThinking?.label ?? '默认')

  const filteredWorkspaces = useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase()
    if (!keyword) return recentWorkspaces
    return recentWorkspaces.filter(item =>
      [item.name, item.path, item.branchName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }, [projectSearch, recentWorkspaces])

  const filteredBranches = useMemo(() => {
    const availableBranches =
      branches.length > 0 || branchName === '无项目' || branchName === '未检测到 Git 分支'
        ? branches
        : [branchName]
    const keyword = branchSearch.trim().toLowerCase()
    if (!keyword) return availableBranches
    return availableBranches.filter(branch => branch.toLowerCase().includes(keyword))
  }, [branchName, branchSearch, branches])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [input])

  function closeDropdown(): void {
    setOpenDropdown(null)
  }

  function getPermissionIcon(value: DesktopPermissionMode): React.ReactNode {
    if (value === 'default') return <Hand size={APP_ICON_SIZE} />
    if (value === 'bypassPermissions') return <ShieldAlert size={APP_ICON_SIZE} />
    if (value === 'customConfig') return <Wrench size={APP_ICON_SIZE} />
    return <ShieldCheck size={APP_ICON_SIZE} />
  }

  function getPermissionClassName(value: DesktopPermissionMode): string {
    return `permission-chip permission-chip-${value}`
  }

  function renderContextSwitchItem(
    label: string,
    enabled: boolean,
    icon: React.ReactNode,
    onToggle: (enabled: boolean) => void,
  ): React.ReactNode {
    return (
      <DropdownMenu.Item
        className="popover-item context-menu-switch-item"
        tabIndex={-1}
        onSelect={event => {
          event.preventDefault()
          onToggle(!enabled)
        }}
      >
        <span className="popover-item-icon">{icon}</span>
        <span className="popover-item-label">{label}</span>
        <span
          aria-checked={enabled}
          className="context-menu-switch"
          role="switch"
        >
          <span className="context-menu-switch-thumb" />
        </span>
      </DropdownMenu.Item>
    )
  }

  const isRunning = sessionStatus === 'running' || sessionStatus === 'waiting'
  const showFullAccessWarning = permissionMode === 'bypassPermissions'
  const contextUsedText = contextUsage
    ? `${formatCompactNumber(contextUsage.usedTokens)} / ${formatCompactNumber(
        contextUsage.contextWindow,
      )} token`
    : '暂无上下文统计'
  const promptCacheHitTokens = contextUsage?.promptCacheHitTokens ?? 0
  const promptCacheMissTokens = contextUsage?.promptCacheMissTokens ?? 0
  const promptCacheTotalTokens =
    promptCacheHitTokens + promptCacheMissTokens
  const promptCacheHitRate =
    promptCacheTotalTokens > 0
      ? Math.round((promptCacheHitTokens / promptCacheTotalTokens) * 100)
      : 0
  const reasoningTokens = contextUsage?.reasoningTokens ?? 0
  const showContextUsageDetails =
    promptCacheTotalTokens > 0 || reasoningTokens > 0

  return (
    <div className="composer">
      {showFullAccessWarning ? (
        <div className="permission-warning-banner">
          <ShieldOff size={APP_ICON_SIZE} />
          <span>完全访问权限 · 此对话允许直接读写文件和运行命令</span>
        </div>
      ) : null}
      <div className="composer-top">
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={event => onInputChange(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              if (canSubmit) onSubmit()
            }}
            placeholder={placeholder}
            rows={1}
          />
        </div>

        <div className="composer-toolbar">
          <div className="toolbar-left">
            <PopoverMenu
              className="popover-context"
              open={openDropdown === 'context'}
              side="top"
              onOpenChange={open => setOpenDropdown(open ? 'context' : null)}
              trigger={
                <IconButton
                  className={[
                    'icon-button',
                    openDropdown === 'context' ? 'active' : '',
                  ].join(' ')}
                  title="添加上下文"
                >
                  <Plus size={APP_ICON_SIZE} />
                </IconButton>
              }
            >
              <div className="popover-section">
                <PopoverItem
                  icon={<Paperclip size={APP_ICON_SIZE} />}
                  onClick={() => {
                    onOpenFiles()
                    closeDropdown()
                  }}
                >
                  添加照片和文件
                </PopoverItem>
              </div>
              <div className="popover-divider" />
              <div className="popover-section">
                {renderContextSwitchItem(
                  '计划模式',
                  planModeEnabled,
                  <ListChecks size={APP_ICON_SIZE} />,
                  setPlanModeEnabled,
                )}
                {renderContextSwitchItem(
                  '追求目标',
                  goalModeEnabled,
                  <Target size={APP_ICON_SIZE} />,
                  setGoalModeEnabled,
                )}
              </div>
              <div className="popover-divider" />
              <div className="popover-section">
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger
                    className="popover-item context-menu-sub-trigger"
                    tabIndex={-1}
                  >
                    <span className="popover-item-icon">
                      <Blocks size={APP_ICON_SIZE} />
                    </span>
                    <span className="popover-item-label">插件</span>
                    <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZE} />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent
                      alignOffset={-8}
                      className="popover popover-sub-content context-plugin-submenu"
                      sideOffset={8}
                    >
                      <div className="popover-header">
                        {INSTALLED_CONTEXT_PLUGINS.length} 个已安装插件
                      </div>
                      <div className="popover-section">
                        {INSTALLED_CONTEXT_PLUGINS.map(plugin => (
                          <DropdownMenu.Item
                            className="popover-item context-plugin-item"
                            key={plugin.name}
                            tabIndex={-1}
                            onSelect={event => event.preventDefault()}
                          >
                            <span
                              className={[
                                'context-plugin-icon',
                                `context-plugin-icon-${plugin.tone}`,
                              ].join(' ')}
                            >
                              {plugin.icon}
                            </span>
                            <span className="popover-item-label">
                              {plugin.name}
                            </span>
                          </DropdownMenu.Item>
                        ))}
                      </div>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              </div>
            </PopoverMenu>
            <Select.Root
              open={openDropdown === 'permission'}
              value={permissionMode}
              onOpenChange={open =>
                setOpenDropdown(open ? 'permission' : null)
              }
              onValueChange={value => {
                onPermissionChange(value as DesktopPermissionMode)
                closeDropdown()
              }}
            >
              <Select.Trigger
                aria-label="选择权限模式"
                className={[
                  'chip-button',
                  getPermissionClassName(permissionMode),
                  openDropdown === 'permission' ? 'active' : '',
                  'permission-select-trigger',
                ].join(' ')}
                title="选择权限模式"
              >
                {getPermissionIcon(permissionMode)}
                <span className="permission-select-trigger-label">
                  {selectedPermission?.label ?? '默认权限'}
                </span>
                <Select.Icon asChild>
                  <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  align="start"
                  className="permission-select-content"
                  collisionPadding={12}
                  position="popper"
                  side="bottom"
                  sideOffset={6}
                >
                  <Select.Viewport className="permission-select-viewport">
                    {permissionOptions.map(option => (
                      <Select.Item
                        className="permission-select-item"
                        key={option.value}
                        value={option.value}
                      >
                        <span className="permission-select-item-icon">
                          {getPermissionIcon(option.value)}
                        </span>
                        <span className="permission-select-item-body">
                          <Select.ItemText>{option.label}</Select.ItemText>
                          {option.detail ? (
                            <span className="permission-select-item-detail">
                              {option.value === 'auto' ? (
                                <>
                                  <span>
                                    {option.detail.replace(/了解更多.*$/, '')}
                                  </span>
                                  <span className="permission-select-item-detail-more">
                                    了解更多
                                  </span>
                                </>
                              ) : (
                                option.detail
                              )}
                            </span>
                          ) : null}
                        </span>
                        <Select.ItemIndicator className="permission-select-item-indicator">
                          <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>

          <div className="toolbar-right">
            {showContextUsage ? (
              <span
                aria-label="上下文窗口使用量"
                className="context-usage-chip"
                tabIndex={0}
              >
                <span className="chip-dot" />
                <span className="context-usage-popover" role="tooltip">
                  <span>上下文窗口：</span>
                  {contextUsage ? (
                    <>
                      <strong>
                        已用 {contextUsage.usedPercent}%，剩余{' '}
                        {contextUsage.remainingPercent}%
                      </strong>
                      <span>已使用 {contextUsedText}</span>
                      {showContextUsageDetails ? (
                        <>
                          {promptCacheTotalTokens > 0 ? (
                            <>
                              <span>缓存详情：</span>
                              <span>
                                命中缓存{' '}
                                {formatCompactNumber(promptCacheHitTokens)}{' '}
                                (命中率 {promptCacheHitRate}%)
                              </span>
                              <span>
                                未命中缓存{' '}
                                {formatCompactNumber(promptCacheMissTokens)}
                              </span>
                            </>
                          ) : null}
                          {reasoningTokens > 0 ? (
                            <span>
                              推理 token:{' '}
                              {formatCompactNumber(reasoningTokens)}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                      <span>
                        {contextUsage.provider
                          ? `${contextUsage.provider} · `
                          : ''}
                        {contextUsage.model}
                      </span>
                    </>
                  ) : (
                    <strong>{contextUsedText}</strong>
                  )}
                </span>
              </span>
            ) : null}
            <PopoverMenu
              className="popover-model"
              open={openDropdown === 'model'}
              side="top"
              onOpenChange={open => setOpenDropdown(open ? 'model' : null)}
              trigger={
                <ChipButton
                  active={openDropdown === 'model'}
                  className="subtle"
                  title={
                    `${selectedProvider?.displayName ?? '模型'} · ${selectedModelTitle}`
                  }
                >
                  <span>
                    {selectedProvider?.displayName
                      ? `${selectedProvider.displayName} · `
                      : ''}
                    {selectedModelLabel}
                    {showThinkingOptions
                      ? ` · ${selectedThinkingLabel}`
                      : ''}
                  </span>
                </ChipButton>
              }
            >
              {showThinkingOptions ? (
                deepSeekThinkingControls ? (
                  <>
                    <div className="popover-header">思考模式</div>
                    <div className="popover-section">
                      <PopoverItem
                        selected={thinkingMode !== 'disabled'}
                        withCheck
                        onClick={() => {
                          onThinkingChange('default')
                        }}
                      >
                        启用
                      </PopoverItem>
                      <PopoverItem
                        selected={thinkingMode === 'disabled'}
                        withCheck
                        onClick={() => {
                          onThinkingChange('disabled')
                          closeDropdown()
                        }}
                      >
                        禁用
                      </PopoverItem>
                    </div>
                    {thinkingMode !== 'disabled' ? (
                      <>
                        <div className="popover-divider" />
                        <div className="popover-header">推理强度</div>
                        <div className="popover-section">
                          <PopoverItem
                            selected={thinkingMode !== 'enabled'}
                            withCheck
                            onClick={() => {
                              onThinkingChange('default')
                              closeDropdown()
                            }}
                          >
                            高
                          </PopoverItem>
                          <PopoverItem
                            selected={thinkingMode === 'enabled'}
                            withCheck
                            onClick={() => {
                              onThinkingChange('enabled')
                              closeDropdown()
                            }}
                          >
                            超高
                          </PopoverItem>
                        </div>
                      </>
                    ) : null}
                    <div className="popover-divider" />
                  </>
                ) : (
                  <>
                    <div className="popover-header">推理</div>
                    <div className="popover-section">
                      {thinkingOptions.map(option => (
                        <PopoverItem
                          key={option.value}
                          selected={option.value === thinkingMode}
                          withCheck
                          onClick={() => {
                            onThinkingChange(option.value)
                            closeDropdown()
                          }}
                        >
                          {option.label}
                        </PopoverItem>
                      ))}
                    </div>
                    <div className="popover-divider" />
                  </>
                )
              ) : null}
              <div className="popover-header">提供商</div>
              <div className="popover-section popover-provider-list">
                {providerOptions.map(provider => (
                  <DropdownMenu.Sub key={provider.providerID}>
                    <DropdownMenu.SubTrigger
                      className={[
                        'popover-item',
                        'popover-sub-trigger',
                        provider.providerID === selectedProviderID
                          ? 'selected'
                          : '',
                      ].join(' ')}
                      tabIndex={-1}
                    >
                      <span className="popover-item-label">
                        {provider.displayName}
                      </span>
                      {provider.providerID === selectedProviderID ? (
                        <Check
                          className="popover-item-check"
                          size={APP_ICON_SIZE}
                          strokeWidth={APP_ICON_STROKE_WIDTH}
                        />
                      ) : null}
                      <ChevronRight
                        className="popover-item-arrow"
                        size={APP_ICON_SIZE}
                      />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        alignOffset={-6}
                        className="popover popover-sub-content popover-model-submenu"
                        sideOffset={8}
                      >
                        <div className="popover-header">模型</div>
                        <div className="popover-section popover-model-list">
                          {provider.modelPresets.map(preset => (
                            <PopoverItem
                              key={preset.id}
                              selected={
                                provider.providerID === selectedProviderID &&
                                preset.id === selectedModelPreset
                              }
                              withCheck
                              onClick={() => {
                                onProviderModelChange(
                                  provider.providerID,
                                  preset.id,
                                )
                                closeDropdown()
                              }}
                            >
                              {preset.label}
                            </PopoverItem>
                          ))}
                          <PopoverItem
                            icon={<Wrench size={APP_ICON_SIZE} />}
                            selected={
                              provider.providerID === selectedProviderID &&
                              selectedModelPreset === CUSTOM_MODEL_PRESET_ID
                            }
                            withCheck
                            onClick={() => {
                              onProviderModelChange(
                                provider.providerID,
                                CUSTOM_MODEL_PRESET_ID,
                              )
                              closeDropdown()
                            }}
                          >
                            自定义模型
                          </PopoverItem>
                        </div>
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                ))}
              </div>
              {!deepSeekThinkingControls ? (
                <>
                  <div className="popover-divider" />
                  <PopoverItem
                    icon={<Zap size={APP_ICON_SIZE} />}
                    meta="暂未接入速度切换"
                    disabled
                  >
                    快速
                  </PopoverItem>
                </>
              ) : null}
            </PopoverMenu>

            <IconButton className="icon-button composer-mic-button" title="语音输入">
              <Mic size={APP_ICON_SIZE} />
            </IconButton>
            <button
              aria-label={isRunning ? '停止' : '发送'}
              className="send-button"
              disabled={!isRunning && !canSubmit}
              onClick={isRunning ? onInterrupt : onSubmit}
              title={isRunning ? '停止' : '发送'}
              type="button"
            >
              {isRunning ? (
                <Square size={APP_ICON_SIZE} fill="currentColor" />
              ) : (
                <ArrowUp size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="composer-bottom">
        <PopoverMenu
          className="popover-project"
          open={openDropdown === 'project'}
          side="top"
          onOpenChange={open => setOpenDropdown(open ? 'project' : null)}
          trigger={
            <MetaChip
              active={openDropdown === 'project'}
              icon={<Folder size={APP_ICON_SIZE} />}
              label={workspace?.name ?? '进入项目工作'}
              title="选择项目"
            />
          }
        >
          <SearchInput
            value={projectSearch}
            onChange={setProjectSearch}
            placeholder="搜索项目"
          />
          <div className="popover-section">
            {filteredWorkspaces.length === 0 ? (
              <div className="popover-empty">无匹配项目</div>
            ) : (
              filteredWorkspaces.map(item => (
                <PopoverItem
                  icon={<Folder size={APP_ICON_SIZE} />}
                  key={item.path}
                  selected={item.path === workspace?.path}
                  withCheck
                  onClick={() => {
                    onOpenWorkspace(item)
                    closeDropdown()
                  }}
                >
                  {item.name}
                </PopoverItem>
              ))
            )}
          </div>
          <div className="popover-divider" />
          <PopoverItem
            icon={<FolderPlus size={APP_ICON_SIZE} />}
            withArrow
            onClick={() => {
              onChooseWorkspace()
              closeDropdown()
            }}
          >
            添加新项目
          </PopoverItem>
        </PopoverMenu>

        {workspace ? (
          <>
            <PopoverMenu
              className="popover-mode"
              open={openDropdown === 'mode'}
              side="top"
              onOpenChange={open => setOpenDropdown(open ? 'mode' : null)}
              trigger={
                <MetaChip
                  active={openDropdown === 'mode'}
                  icon={<Monitor size={APP_ICON_SIZE} />}
                  label="本地模式"
                  title="启动模式"
                />
              }
            >
              <div className="popover-header">启动模式</div>
              <div className="popover-section">
                <PopoverItem icon={<Monitor size={APP_ICON_SIZE} />} selected withCheck>
                  本地模式
                </PopoverItem>
                <PopoverItem icon={<GitBranch size={APP_ICON_SIZE} />} disabled>
                  新工作树
                </PopoverItem>
                <PopoverItem icon={<Search size={APP_ICON_SIZE} />} disabled>
                  关联 CodePilotX Web
                </PopoverItem>
              </div>
            </PopoverMenu>

            <PopoverMenu
              className="popover-branch"
              open={openDropdown === 'branch'}
              side="top"
              onOpenChange={open => setOpenDropdown(open ? 'branch' : null)}
              trigger={
                <MetaChip
                  active={openDropdown === 'branch'}
                  icon={<GitBranch size={APP_ICON_SIZE} />}
                  label={branchName}
                  title="选择分支"
                />
              }
            >
              <SearchInput
                value={branchSearch}
                onChange={setBranchSearch}
                placeholder="搜索分支"
              />
              <div className="popover-section">
                <div className="popover-section-title">分支</div>
                {filteredBranches.length === 0 ? (
                  <div className="popover-empty">无匹配分支</div>
                ) : (
                  filteredBranches.map(branch => (
                    <PopoverItem
                      icon={<GitBranch size={APP_ICON_SIZE} />}
                      key={branch}
                      selected={branch === branchName}
                      withCheck={branch === branchName}
                      onClick={() => {
                        onBranchSelect(branch)
                        closeDropdown()
                      }}
                    >
                      {branch}
                    </PopoverItem>
                  ))
                )}
              </div>
              <div className="popover-divider" />
              <PopoverItem
                icon={<Plus size={APP_ICON_SIZE} />}
                onClick={() => {
                  onCreateBranch()
                  closeDropdown()
                }}
              >
                创建并检出新分支...
              </PopoverItem>
            </PopoverMenu>
          </>
        ) : null}

      </div>
    </div>
  )
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)}M`
  }
  if (value >= 1_000) {
    return `${trimNumber(value / 1_000)}k`
  }
  return String(value)
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
