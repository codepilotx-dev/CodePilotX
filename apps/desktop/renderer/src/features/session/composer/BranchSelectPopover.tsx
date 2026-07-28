import React from 'react'
import { GitBranch, Plus } from 'lucide-react'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SearchablePopoverContent } from '../../../components/ui/SearchablePopoverContent.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { PopoverSizingProps } from '../../../components/ui/popoverSizing.js'

type BranchSelectPopoverProps = BranchSelectPopoverContentProps & {
  align?: 'start' | 'center' | 'end'
  className: string
  disableOutsideDismiss?: boolean
  open: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  trigger: React.ReactNode
  onOpenChange: (open: boolean) => void
} & PopoverSizingProps

export function BranchSelectPopover({
  align,
  className,
  disableOutsideDismiss,
  open,
  side,
  sideOffset,
  trigger,
  width,
  onOpenChange,
  ...contentProps
}: BranchSelectPopoverProps): React.ReactNode {
  return (
    <PopoverMenu
      align={align}
      className={`popover-menu--grid ${className}`}
      disableOutsideDismiss={disableOutsideDismiss}
      open={open}
      side={side}
      sideOffset={sideOffset}
      trigger={trigger}
      width={width}
      onOpenChange={onOpenChange}
    >
      <BranchSelectPopoverContent
        {...contentProps}
        onBranchSelect={(branch) => {
          void contentProps.onBranchSelect(branch)
          onOpenChange(false)
        }}
        onCreateBranch={() => {
          contentProps.onCreateBranch()
          onOpenChange(false)
        }}
      />
    </PopoverMenu>
  )
}

type BranchSelectPopoverContentProps = {
  branchSearch: string
  branches: string[]
  currentBranchDetail?: string
  currentBranchName: string
  onBranchSearchChange: (value: string) => void
  onBranchSelect: (branch: string) => void | Promise<void>
  onCreateBranch: () => void
}

export function BranchSelectPopoverContent({
  branchSearch,
  branches,
  currentBranchDetail,
  currentBranchName,
  onBranchSearchChange,
  onBranchSelect,
  onCreateBranch,
}: BranchSelectPopoverContentProps): React.ReactNode {
  const visibleBranches = React.useMemo(() => {
    const branchSet = new Set(branches)
    if (
      currentBranchName &&
      currentBranchName !== '无项目' &&
      currentBranchName !== '未检测到 Git 分支'
    ) {
      branchSet.add(currentBranchName)
    }
    const keyword = branchSearch.trim().toLowerCase()
    const availableBranches = [...branchSet]
    if (!keyword) return availableBranches
    return availableBranches.filter(branch =>
      branch.toLowerCase().includes(keyword),
    )
  }, [branchSearch, branches, currentBranchName])

  return (
    <SearchablePopoverContent
      listClassName="branch-popover-list-scroll"
      search={
        <SearchInput
          aria-label="搜索分支"
          value={branchSearch}
          onChange={onBranchSearchChange}
          placeholder="搜索分支"
        />
      }
      footer={
        <PopoverItem
          icon={<Plus size={APP_ICON_SIZE} />}
          onClick={onCreateBranch}
        >
          创建并检出新分支...
        </PopoverItem>
      }
    >
      <div className="popover-section">
        <div className="popover-section-title">分支</div>
        {visibleBranches.length === 0 ? (
          <div className="popover-empty">无匹配分支</div>
        ) : (
          visibleBranches.map((branch) => {
            const selected = branch === currentBranchName
            return (
              <PopoverItem
                icon={<GitBranch size={APP_ICON_SIZE} />}
                key={branch}
                selected={selected}
                withCheck={selected}
                onClick={() => onBranchSelect(branch)}
              >
                {currentBranchDetail && selected ? (
                  <span className="environment-branch-label">
                    <span>{branch}</span>
                    <small>{currentBranchDetail}</small>
                  </span>
                ) : (
                  branch
                )}
              </PopoverItem>
            )
          })
        )}
      </div>
    </SearchablePopoverContent>
  )
}
