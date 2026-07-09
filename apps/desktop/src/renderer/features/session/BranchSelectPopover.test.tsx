import { expect, test } from 'bun:test'
import React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { renderToStaticMarkup } from 'react-dom/server'
import { BranchSelectPopoverContent } from './BranchSelectPopover.js'

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <DropdownMenu.Root open>
      <DropdownMenu.Content>{node}</DropdownMenu.Content>
    </DropdownMenu.Root>,
  )
}

test('BranchSelectPopoverContent keeps search, scroll list, and footer as separate regions', () => {
  const html = render(
    <BranchSelectPopoverContent
      branches={['main', 'dev']}
      branchSearch=""
      currentBranchName="main"
      currentBranchDetail="未提交：2 个文件"
      onBranchSearchChange={() => {}}
      onBranchSelect={() => {}}
      onCreateBranch={() => {}}
    />,
  )

  const searchIndex = html.indexOf('class="search-input"')
  const scrollIndex = html.indexOf('class="branch-popover-list-scroll"')
  const dividerIndex = html.indexOf('class="popover-divider"')
  const createIndex = html.indexOf('创建并检出新分支...')

  expect(searchIndex).toBeGreaterThanOrEqual(0)
  expect(scrollIndex).toBeGreaterThan(searchIndex)
  expect(dividerIndex).toBeGreaterThan(scrollIndex)
  expect(createIndex).toBeGreaterThan(dividerIndex)
})

test('BranchSelectPopoverContent shows the current branch detail and selected check only on the current branch', () => {
  const html = render(
    <BranchSelectPopoverContent
      branches={['main', 'dev']}
      branchSearch=""
      currentBranchName="main"
      currentBranchDetail="未提交：2 个文件"
      onBranchSearchChange={() => {}}
      onBranchSelect={() => {}}
      onCreateBranch={() => {}}
    />,
  )

  expect(html).toContain('未提交：2 个文件')
  expect(html.match(/ selected/g)?.length).toBe(1)
})
