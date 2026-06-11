import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Folder,
  FolderPlus,
  GitBranch,
  Hand,
  Mic,
  Monitor,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Wrench,
  Zap,
} from 'lucide-react'
import type {
  DesktopPermissionMode,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopWorkspace,
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

const PERMISSION_MENU_ICON_SIZE = 16
const PERMISSION_TRIGGER_ICON_SIZE = 18
const META_CHIP_ICON_SIZE = 14

type ComposerDropdown = 'permission' | 'model' | 'project' | 'mode' | 'branch'

type Props = {
  input: string
  canSubmit: boolean
  sessionStatus: DesktopSessionStatus
  permissionMode: DesktopPermissionMode
  thinkingMode: DesktopThinkingMode
  selectedModelPreset: string
  modelPresets: ModelPreset[]
  permissionOptions: Option<DesktopPermissionMode>[]
  thinkingOptions: Option<DesktopThinkingMode>[]
  branchName: string
  recentWorkspaces: DesktopWorkspace[]
  workspace: DesktopWorkspace | null
  placeholder?: string
  onChooseWorkspace: () => void
  onInputChange: (value: string) => void
  onInterrupt: () => void
  onModelChange: (value: string) => void
  onOpenFiles: () => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => void
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
  selectedModelPreset,
  modelPresets,
  permissionOptions,
  thinkingOptions,
  branchName,
  recentWorkspaces,
  workspace,
  placeholder = '随心输入',
  onChooseWorkspace,
  onInputChange,
  onInterrupt,
  onModelChange,
  onOpenFiles,
  onOpenWorkspace,
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

  const selectedPermission = permissionOptions.find(
    option => option.value === permissionMode,
  )
  const selectedModel = modelPresets.find(
    preset => preset.id === selectedModelPreset,
  )
  const selectedThinking = thinkingOptions.find(
    option => option.value === thinkingMode,
  )

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
    const branches = branchName ? [branchName] : []
    const keyword = branchSearch.trim().toLowerCase()
    if (!keyword) return branches
    return branches.filter(branch => branch.toLowerCase().includes(keyword))
  }, [branchName, branchSearch])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [input])

  function closeDropdown(): void {
    setOpenDropdown(null)
  }

  function getPermissionIcon(
    value: DesktopPermissionMode,
    size = 14,
  ): React.ReactNode {
    if (value === 'default') return <Hand size={size} />
    if (value === 'bypassPermissions') return <ShieldAlert size={size} />
    if (value === 'dontAsk') return <Wrench size={size} />
    return <ShieldCheck size={size} />
  }

  function getPermissionClassName(value: DesktopPermissionMode): string {
    return `permission-chip permission-chip-${value}`
  }

  const isRunning = sessionStatus === 'running' || sessionStatus === 'waiting'

  return (
    <div className="composer">
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
            <IconButton onClick={onOpenFiles} title="添加上下文">
              <Plus size={18} />
            </IconButton>
            <PopoverMenu
              open={openDropdown === 'permission'}
              autoWidth
              onOpenChange={open => setOpenDropdown(open ? 'permission' : null)}
              trigger={
                <ChipButton
                  active={openDropdown === 'permission'}
                  className={getPermissionClassName(permissionMode)}
                  title="选择权限模式"
                >
                  {getPermissionIcon(
                    permissionMode,
                    PERMISSION_TRIGGER_ICON_SIZE,
                  )}
                  <span>{selectedPermission?.label ?? '默认权限'}</span>
                </ChipButton>
              }
            >
              <div className="popover-section">
                {permissionOptions.map(option => (
                  <PopoverItem
                    icon={getPermissionIcon(
                      option.value,
                      PERMISSION_MENU_ICON_SIZE,
                    )}
                    key={option.value}
                    meta={option.detail}
                    selected={option.value === permissionMode}
                    withCheck
                    onClick={() => {
                      onPermissionChange(option.value)
                      closeDropdown()
                    }}
                  >
                    {option.label}
                  </PopoverItem>
                ))}
              </div>
            </PopoverMenu>
          </div>

          <div className="toolbar-right">
            <PopoverMenu
              className="popover-model"
              open={openDropdown === 'model'}
              onOpenChange={open => setOpenDropdown(open ? 'model' : null)}
              trigger={
                <ChipButton
                  active={openDropdown === 'model'}
                  className="subtle"
                  showDot
                  title="选择模型"
                >
                  <span>
                    {selectedModel?.label ?? selectedModelPreset} ·{' '}
                    {selectedThinking?.label ?? '默认'}
                  </span>
                </ChipButton>
              }
            >
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
              <div className="popover-header">模型</div>
              <div className="popover-section">
                {modelPresets.map(preset => (
                  <PopoverItem
                    icon={<Bot size={14} />}
                    key={preset.id}
                    selected={preset.id === selectedModelPreset}
                    withCheck
                    onClick={() => {
                      onModelChange(preset.id)
                      closeDropdown()
                    }}
                  >
                    {preset.label}
                  </PopoverItem>
                ))}
                <PopoverItem
                  icon={<Wrench size={14} />}
                  selected={selectedModelPreset === CUSTOM_MODEL_PRESET_ID}
                  withCheck
                  onClick={() => {
                    onModelChange(CUSTOM_MODEL_PRESET_ID)
                    closeDropdown()
                  }}
                >
                  自定义模型
                </PopoverItem>
              </div>
              <div className="popover-divider" />
              <PopoverItem
                icon={<Zap size={14} />}
                meta="暂未接入速度切换"
                disabled
              >
                快速
              </PopoverItem>
            </PopoverMenu>

            <IconButton className="icon-button composer-mic-button" title="语音输入">
              <Mic size={18} />
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
                <Square size={12} fill="currentColor" />
              ) : (
                <Send size={24} />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="composer-bottom">
        <PopoverMenu
          className="popover-project"
          open={openDropdown === 'project'}
          onOpenChange={open => setOpenDropdown(open ? 'project' : null)}
          trigger={
            <MetaChip
              active={openDropdown === 'project'}
              icon={<Folder size={META_CHIP_ICON_SIZE} />}
              label={workspace?.name ?? '无项目对话'}
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
                  icon={<Folder size={14} />}
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
            icon={<FolderPlus size={14} />}
            withArrow
            onClick={() => {
              onChooseWorkspace()
              closeDropdown()
            }}
          >
            添加新项目
          </PopoverItem>
        </PopoverMenu>

        <PopoverMenu
          className="popover-mode"
          open={openDropdown === 'mode'}
          onOpenChange={open => setOpenDropdown(open ? 'mode' : null)}
          trigger={
            <MetaChip
              active={openDropdown === 'mode'}
              icon={<Monitor size={META_CHIP_ICON_SIZE} />}
              label="本地模式"
              title="启动模式"
            />
          }
        >
          <div className="popover-header">启动模式</div>
          <div className="popover-section">
            <PopoverItem icon={<Monitor size={14} />} selected withCheck>
              本地模式
            </PopoverItem>
            <PopoverItem icon={<GitBranch size={14} />} disabled>
              新工作树
            </PopoverItem>
            <PopoverItem icon={<Search size={14} />} disabled>
              关联 Codex Web
            </PopoverItem>
          </div>
        </PopoverMenu>

        <PopoverMenu
          className="popover-branch"
          open={openDropdown === 'branch'}
          onOpenChange={open => setOpenDropdown(open ? 'branch' : null)}
          trigger={
            <MetaChip
              active={openDropdown === 'branch'}
              icon={<GitBranch size={META_CHIP_ICON_SIZE} />}
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
                  icon={<GitBranch size={14} />}
                  key={branch}
                  selected
                  withCheck
                  onClick={closeDropdown}
                >
                  {branch}
                </PopoverItem>
              ))
            )}
          </div>
          <div className="popover-divider" />
          <PopoverItem icon={<Plus size={14} />} disabled>
            创建并检出新分支...
          </PopoverItem>
        </PopoverMenu>

        {!workspace ? (
          <span className="composer-meta-note">未选择项目文件夹</span>
        ) : workspace.isGitRepo === false ? (
          <span className="composer-meta-note">非 Git 项目</span>
        ) : (
          workspace?.path && (
            <span className="composer-meta-note">{workspace.path}</span>
          )
        )}
      </div>
    </div>
  )
}
