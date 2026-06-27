import type React from 'react'
import { useMemo, useState } from 'react'
import { Folder, FolderPlus, FolderX, GitFork } from 'lucide-react'
import { APP_ICON_SIZE } from './ui/iconTokens.js'
import { PopoverItem } from './ui/PopoverItem.js'
import { PopoverMenu } from './ui/PopoverMenu.js'
import { SearchInput } from './ui/SearchInput.js'
import type { DesktopWorkspace } from '../../shared/types.js'

type Props = {
  recentWorkspaces: DesktopWorkspace[]
  workspace: DesktopWorkspace | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => void
  onChooseWorkspace: () => void
  onCloneGithub?: () => void
  onClearWorkspace: () => void
  trigger: React.ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'right' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

export function ProjectSwitcherPopover({
  recentWorkspaces,
  workspace,
  open,
  onOpenChange,
  onOpenWorkspace,
  onChooseWorkspace,
  onCloneGithub,
  onClearWorkspace,
  trigger,
  className = 'popover-project',
  side,
  align,
  sideOffset,
}: Props): React.ReactNode {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return recentWorkspaces
    return recentWorkspaces.filter(item =>
      [item.name, item.path, item.branchName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }, [recentWorkspaces, search])
  const isUnset = workspace === null

  return (
    <PopoverMenu
      align={align}
      className={className}
      open={open}
      side={side}
      sideOffset={sideOffset}
      onOpenChange={onOpenChange}
      trigger={trigger}
    >
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="搜索项目"
      />
      <div className="popover-section">
        {filtered.length === 0 ? (
          <div className="popover-empty">无匹配项目</div>
        ) : (
          filtered.map(item => (
            <PopoverItem
              icon={<Folder size={APP_ICON_SIZE} />}
              key={item.path}
              selected={item.path === workspace?.path}
              withCheck
              onClick={() => {
                onOpenWorkspace(item)
                onOpenChange(false)
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
          onOpenChange(false)
        }}
      >
        添加新项目
      </PopoverItem>
      {onCloneGithub ? (
        <PopoverItem
          icon={<GitFork size={APP_ICON_SIZE} />}
          withArrow
          onClick={() => {
            onCloneGithub()
            onOpenChange(false)
          }}
        >
          从 GitHub 克隆
        </PopoverItem>
      ) : null}
      <PopoverItem
        icon={<FolderX size={APP_ICON_SIZE} />}
        selected={isUnset}
        withCheck={isUnset}
        onClick={() => {
          onClearWorkspace()
          onOpenChange(false)
        }}
      >
        不使用项目
      </PopoverItem>
    </PopoverMenu>
  )
}
