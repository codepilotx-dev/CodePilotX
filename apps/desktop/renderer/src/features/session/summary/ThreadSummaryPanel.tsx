import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import {
  Bot,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Laptop,
  Link2,
  ListChecks,
  Plus,
  RefreshCcw,
  SquarePlus,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/iconTokens.js'
import { cx } from '../../../utils/cx.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { BranchSelectPopover } from '../composer/BranchSelectPopover.js'
import type { ThreadSummaryViewModel } from './threadSummaryViewModel.js'
import { previewThreadSummarySources } from './threadSummaryViewModel.js'
import type { OpenPlanInDockRequest } from '../workflow/WorkflowPlanCard.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'

/**
 * 置顶摘要的宽度契约：行在浮层里靠 `--thread-summary-inline-width` 取得与内联
 * 面板一致的宽度，浮层挂在 Portal 上，必须自己再声明一次该变量。
 */
const THREAD_SUMMARY_WIDTH_CLASS = 'tw:w-[var(--thread-summary-inline-width)] tw:max-w-full'

const SUMMARY_ROW_CLASS =
  'interactive-row interactive-row--nav thread-summary-row tw:grid tw:w-[calc(100%+16px)] tw:min-w-0 tw:-mx-2 tw:grid-cols-[16px_minmax(0,1fr)_max-content] tw:text-left tw:no-underline tw:type-body'

const SUMMARY_ROW_LABEL_CLASS = 'tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap'

const SUMMARY_ROW_ICON_CLASS = 'tw:text-app-text'

type ThreadSummaryActions = {
  onBranchSelect: (branch: string) => Promise<void>
  onCommitOrPush: () => void
  onCreateBranch: () => void
  onCreatePullRequest: () => void
  onOpenPlan: (plan: OpenPlanInDockRequest) => void
  onOpenReview: () => void
  onOpenSubagent?: (taskId: string) => void
  onOpenWorkspacePath: () => void
}

type ThreadSummaryPanelProps = ThreadSummaryActions & {
  branches: string[]
  model: ThreadSummaryViewModel
}

export function ThreadSummaryPopover({
  children,
  open,
  panel,
  onOpenChange,
}: {
  children: React.ReactElement
  open: boolean
  panel: React.ReactNode
  onOpenChange: (open: boolean) => void
}): React.ReactNode {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          aria-label="置顶摘要"
          className={`thread-summary-popover ${THREAD_SUMMARY_WIDTH_CLASS} tw:max-h-[min(680px,calc(100vh-80px))]`}
          collisionPadding={12}
          side="bottom"
          sideOffset={8}
        >
          {panel}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ThreadSummaryInline({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <div
      className="thread-summary-inline tw:absolute tw:top-4 tw:bottom-4 tw:end-[var(--thread-summary-inline-edge)] tw:z-sticky tw:w-[var(--thread-summary-inline-width)] tw:min-h-0 tw:origin-right"
      data-testid="thread-summary-inline"
    >
      {children}
    </div>
  )
}

export class ThreadSummaryErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; retryKey: number }
> {
  state = { failed: false, retryKey: 0 }

  static getDerivedStateFromError(): Partial<{
    failed: boolean
    retryKey: number
  }> {
    return { failed: true }
  }

  retry = (): void => {
    this.setState((state) => ({
      failed: false,
      retryKey: state.retryKey + 1,
    }))
  }

  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <section
          aria-label="摘要加载失败"
          className={`thread-summary-error ${THREAD_SUMMARY_WIDTH_CLASS} tw:grid tw:min-h-45 tw:place-content-center tw:justify-items-center tw:gap-2 tw:p-5 tw:text-center`}
          role="alert"
        >
          <strong>摘要暂时无法显示</strong>
          <span className="tw:text-app-text-meta tw:type-body-sm">会话本身不受影响。</span>
          <button
            type="button"
            onClick={this.retry}
            className="tw:mt-2 tw:inline-flex tw:items-center tw:gap-1 tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-2 tw:text-app-text tw:[font:inherit] tw:cursor-pointer tw:focus-visible:outline-1 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
          >
            <RefreshCcw size={APP_ICON_SIZE} />
            重试
          </button>
        </section>
      )
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>
  }
}

export function ThreadSummaryPanel({
  branches,
  model,
  onBranchSelect,
  onCommitOrPush,
  onCreateBranch,
  onCreatePullRequest,
  onOpenPlan,
  onOpenReview,
  onOpenWorkspacePath,
}: ThreadSummaryPanelProps): React.ReactNode {
  const [branchPopoverOpen, setBranchPopoverOpen] = React.useState(false)
  const [branchSearch, setBranchSearch] = React.useState('')
  const [sourcesPanelOpen, setSourcesPanelOpen] = React.useState(false)
  const sourcePreview = previewThreadSummarySources(model.sources)
  const sourceListId = React.useId()
  const changes = model.changes ?? {
    additions: 0,
    deletions: 0,
    fileCount: 0,
  }
  const hasChanges = changes.fileCount > 0 || changes.additions > 0 || changes.deletions > 0

  return (
    <aside
      className={`thread-summary-panel ${THREAD_SUMMARY_WIDTH_CLASS} tw:flex tw:min-h-0 tw:flex-col tw:gap-3 tw:overflow-x-hidden tw:overflow-y-auto tw:pt-3 tw:pb-2 tw:[scrollbar-width:thin]`}
      aria-label="置顶摘要"
    >
      {model.environment ? (
        <ThreadSummarySection
          collapsedSummary={
            hasChanges ? (
              <span className="thread-summary-diff tw:inline-flex tw:gap-1 tw:type-caption tw:tabular-nums">
                <strong className="tw:text-app-success tw:type-weight-body">+{changes.additions}</strong>
                <em className="tw:text-app-danger tw:not-italic">-{changes.deletions}</em>
              </span>
            ) : null
          }
          first
          title="环境信息"
          actionLabel="暂不支持创建本地环境"
        >
          <button
            className={SUMMARY_ROW_CLASS}
            title="打开变更审查"
            type="button"
            onClick={onOpenReview}
          >
            <SquarePlus className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
            <span className={SUMMARY_ROW_LABEL_CLASS}>变更</span>
            {hasChanges ? (
              <small className="thread-summary-change-summary tw:inline-flex tw:items-center tw:justify-end tw:gap-2 tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">
                <span className="thread-summary-diff tw:inline-flex tw:gap-1 tw:type-caption tw:tabular-nums">
                  <strong className="tw:text-app-success tw:type-weight-body">+{changes.additions}</strong>
                  <em className="tw:text-app-danger tw:not-italic">-{changes.deletions}</em>
                </span>
              </small>
            ) : null}
          </button>
          <div
            className="thread-summary-row-group tw:grid tw:w-[calc(100%+16px)] tw:-mx-2 tw:grid-cols-[minmax(0,1fr)_28px]"
            title={model.environment.workspacePath}
          >
            <button
              className="interactive-row interactive-row--nav thread-summary-row-group__main tw:grid tw:min-w-0 tw:grid-cols-[16px_minmax(0,1fr)] tw:bg-transparent tw:text-left tw:type-body"
              type="button"
              onClick={onOpenWorkspacePath}
            >
              <Laptop className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
              <span className={SUMMARY_ROW_LABEL_CLASS}>本地</span>
            </button>
            <DisabledSummaryControl label="暂不支持切换执行位置">
              <ChevronDown aria-hidden="true" size={APP_ICON_SIZES.sm} />
            </DisabledSummaryControl>
          </div>
          <BranchSelectPopover
            align="start"
            branchSearch={branchSearch}
            branches={branches}
            className="popover-thread-summary-branch"
            currentBranchDetail={`未提交：${model.environment.changedFileCount} 个文件`}
            currentBranchName={model.environment.branchName ?? ''}
            open={branchPopoverOpen}
            side="left"
            sideOffset={8}
            width={220}
            onBranchSearchChange={setBranchSearch}
            onBranchSelect={onBranchSelect}
            onCreateBranch={onCreateBranch}
            onOpenChange={setBranchPopoverOpen}
            trigger={
              <button
                className={SUMMARY_ROW_CLASS}
                data-state={branchPopoverOpen ? 'open' : 'closed'}
                title={model.environment.branchName ?? '未检测到 Git 分支'}
                type="button"
              >
                <GitBranch className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
                <span className={SUMMARY_ROW_LABEL_CLASS}>
                  {model.environment.branchName ?? '未检测到 Git 分支'}
                </span>
                <ChevronDown aria-hidden="true" size={APP_ICON_SIZES.sm} />
              </button>
            }
          />
          <SummaryGitActionRow
            enabled={model.environment.commitOrPushEnabled}
            disabledReason={
              model.environment.commitOrPushDisabledReason ?? '当前工作区不可执行 Git 操作'
            }
            icon={<GitCommitHorizontal aria-hidden="true" size={APP_ICON_SIZE} />}
            label="提交或推送"
            onClick={onCommitOrPush}
          />
          <SummaryGitActionRow
            enabled={model.environment.createPullRequestEnabled}
            disabledReason={
              model.environment.createPullRequestDisabledReason ?? '当前分支不可创建拉取请求'
            }
            icon={<GitPullRequest aria-hidden="true" size={APP_ICON_SIZE} />}
            label="创建拉取请求"
            onClick={onCreatePullRequest}
          />
        </ThreadSummarySection>
      ) : null}

      {model.plan ? (
        <ThreadSummarySection title="计划">
          <button
            className={SUMMARY_ROW_CLASS}
            type="button"
            onClick={() => onOpenPlan(model.plan!)}
          >
            <ListChecks className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
            <span className={SUMMARY_ROW_LABEL_CLASS}>{model.plan.title}</span>
          </button>
        </ThreadSummarySection>
      ) : null}

      {sourcePreview.items.length ? (
        <ThreadSummarySection title="来源" actionLabel="暂不支持手动添加来源" rowsId={sourceListId}>
          {sourcePreview.items.map((source) => (
            <a
              className={SUMMARY_ROW_CLASS}
              href={source.url}
              key={source.url}
              rel="noreferrer"
              target="_blank"
              title={source.url}
            >
              <Link2 className={SUMMARY_ROW_ICON_CLASS} aria-hidden="true" size={APP_ICON_SIZE} />
              <span className={SUMMARY_ROW_LABEL_CLASS}>{source.label}</span>
            </a>
          ))}
          <button
            aria-haspopup="dialog"
            className={`${SUMMARY_ROW_CLASS} thread-summary-source-toggle tw:text-app-text-meta tw:[&>svg:first-child]:text-app-text-meta tw:hover:text-app-text tw:focus-visible:text-app-text tw:hover:[&>svg:first-child]:text-app-text tw:focus-visible:[&>svg:first-child]:text-app-text`}
            type="button"
            onClick={() => setSourcesPanelOpen(true)}
          >
            <Link2 aria-hidden="true" size={APP_ICON_SIZE} />
            <span className={SUMMARY_ROW_LABEL_CLASS}>查看全部</span>
          </button>
        </ThreadSummarySection>
      ) : null}

      {model.subagents.length ? (
        <ThreadSummarySection title="子智能体">
          <ThreadSummarySubagentsRow subagents={model.subagents} />
        </ThreadSummarySection>
      ) : null}

      <ThreadSummarySourcesPanel
        open={sourcesPanelOpen}
        sources={model.sources}
        onOpenChange={setSourcesPanelOpen}
      />
    </aside>
  )
}

function ThreadSummarySubagentsRow({
  subagents,
}: {
  subagents: ThreadSummaryViewModel['subagents']
}): React.ReactNode {
  const activeCount = subagents.filter(
    (subagent) => !isFinishedSubagentStatus(subagent.status),
  ).length
  const finishedCount = subagents.length - activeCount
  const label = activeCount > 0 ? `${activeCount} 正在运行` : `${finishedCount} 完成`

  return (
    <div
      aria-label={`子智能体：${label}`}
      className="thread-summary-row thread-summary-subagents-summary tw:box-border tw:min-h-7 tw:items-center tw:gap-2 tw:rounded-container tw:px-2 tw:text-app-text tw:cursor-default tw:select-none tw:type-body"
      title={subagents.map((subagent) => subagent.name).join('、')}
    >
      <span className="thread-summary-subagents-summary__avatars tw:flex tw:items-center tw:overflow-visible">
        {subagents.slice(0, 4).map((subagent, index) => (
          <span
            aria-hidden="true"
            className={cx(
              'tw:inline-flex tw:size-[18px] tw:items-center tw:justify-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:[&+span]:-ml-2',
              index === 1
                ? 'tw:text-app-accent-fg'
                : index === 2
                  ? 'tw:text-app-success'
                  : index === 3
                    ? 'tw:text-app-warning'
                    : 'tw:text-app-text',
            )}
            key={subagent.id}
          >
            <Bot data-icon-kind="artwork" size={14} />
          </span>
        ))}
      </span>
      <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{label}</span>
      {activeCount > 0 && finishedCount > 0 ? (
        <small className="tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">
          {finishedCount} 完成
        </small>
      ) : null}
    </div>
  )
}

function ThreadSummarySourcesPanel({
  open,
  sources,
  onOpenChange,
}: {
  open: boolean
  sources: ThreadSummaryViewModel['sources']
  onOpenChange: (open: boolean) => void
}): React.ReactNode {
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop thread-summary-sources-overlay tw:fixed tw:inset-0 tw:z-modal" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--side-right thread-summary-sources-panel tw:fixed tw:z-popover tw:top-3 tw:right-3 tw:bottom-3 tw:flex tw:w-[min(360px,calc(100vw-24px))] tw:flex-col tw:gap-3 tw:rounded-xl tw:p-4 tw:text-app-text tw:outline-none"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
              <Dialog.Title className="tw:m-0 tw:type-row-title">来源</Dialog.Title>
              <span className="tw:text-app-text-meta tw:type-caption">{sources.length}</span>
            </div>
            <Dialog.Close asChild>
              <IconButton color="ghostSecondary" size="toolbar" title="关闭来源面板">
                <X aria-hidden="true" size={APP_ICON_SIZE} />
              </IconButton>
            </Dialog.Close>
          </header>
          <Dialog.Description className="tw:m-0 tw:text-app-text-meta tw:type-body-sm">
            当前会话中已识别的文件与网页来源。
          </Dialog.Description>
          <div
            className="thread-summary-sources-panel__list tw:grid tw:min-h-0 tw:content-start tw:gap-1 tw:overflow-y-auto"
            role="list"
          >
            {sources.map((source) => (
              <a
                className="interactive-row interactive-row--nav tw:grid tw:min-w-0 tw:grid-cols-[16px_minmax(0,1fr)] tw:no-underline"
                href={source.url}
                key={source.url}
                rel="noreferrer"
                role="listitem"
                target="_blank"
                title={source.url}
              >
                <Link2 aria-hidden="true" size={APP_ICON_SIZE} />
                <span className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                  {source.label}
                </span>
              </a>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ThreadSummarySection({
  actionLabel,
  children,
  collapsedSummary,
  first = false,
  rowsId,
  title,
}: {
  actionLabel?: string
  children: React.ReactNode
  collapsedSummary?: React.ReactNode
  first?: boolean
  rowsId?: string
  title: string
}): React.ReactNode {
  const headingId = React.useId()
  const generatedRowsId = React.useId()
  const contentId = rowsId ?? generatedRowsId
  const [expanded, setExpanded] = React.useState(true)
  return (
    <section
      aria-labelledby={headingId}
      className={
        first
          ? 'thread-summary-section thread-summary-section--first tw:relative tw:z-0 tw:flex tw:flex-col tw:pb-3 tw:last:pb-1'
          : 'thread-summary-section tw:relative tw:z-0 tw:flex tw:flex-col tw:pb-3 tw:last:pb-1'
      }
    >
      <header className="tw:sticky tw:top-0 tw:z-local tw:flex tw:h-7 tw:w-full tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:bg-transparent tw:pt-0 tw:pr-3 tw:pb-1 tw:pl-4 tw:text-app-text-soft tw:type-row-title">
        <h2 className="tw:m-0 tw:text-inherit tw:[font:inherit]">
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            className="thread-summary-section__toggle tw:inline-flex tw:min-w-0 tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:py-1 tw:pr-1 tw:pl-0 tw:text-left tw:text-inherit tw:[font:inherit] tw:cursor-pointer tw:outline-none tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" id={headingId}>
              {title}
            </span>
            {!expanded ? collapsedSummary : null}
            <ChevronDown aria-hidden="true" size={APP_ICON_SIZES.sm} />
          </button>
        </h2>
        <span className="thread-summary-section__actions tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:justify-end">
          {actionLabel ? (
            <DisabledSummaryControl label={actionLabel}>
              <Plus aria-hidden="true" size={APP_ICON_SIZE} />
            </DisabledSummaryControl>
          ) : null}
        </span>
      </header>
      <DisclosureContent
        className="thread-summary-section__content tw:relative tw:z-0"
        contentClassName="thread-summary-section__rows tw:grid tw:min-h-0 tw:gap-0 tw:overflow-hidden tw:px-4 tw:pt-1"
        expanded={expanded}
        id={contentId}
      >
        {children}
      </DisclosureContent>
    </section>
  )
}

function DisabledSummaryControl({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}): React.ReactNode {
  return (
    <Tooltip content={label} side="left">
      <button
        aria-disabled="true"
        aria-label={label}
        className="thread-summary-disabled-control tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:justify-self-end tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-meta tw:[font:inherit] tw:cursor-not-allowed tw:outline-none tw:hover:bg-app-hover tw:focus-visible:bg-app-hover tw:focus-visible:outline-1 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus tw:[&>svg]:size-icon-sm"
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function SummaryGitActionRow({
  disabledReason,
  enabled,
  icon,
  label,
  onClick,
}: {
  disabledReason: string
  enabled: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}): React.ReactNode {
  const row = (
    <button
      aria-disabled={!enabled}
      className={`${SUMMARY_ROW_CLASS} tw:aria-disabled:[&>svg:first-child]:text-app-text-disabled`}
      type="button"
      onClick={(event) => {
        if (!enabled) {
          event.preventDefault()
          return
        }
        onClick()
      }}
    >
      {icon}
      <span className={SUMMARY_ROW_LABEL_CLASS}>{label}</span>
    </button>
  )
  return enabled ? row : <Tooltip content={disabledReason}>{row}</Tooltip>
}

function isFinishedSubagentStatus(status: string): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'stopped' ||
    status === 'interrupted'
  )
}
