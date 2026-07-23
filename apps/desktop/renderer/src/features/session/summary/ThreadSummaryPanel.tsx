import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
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
} from "lucide-react";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { BranchSelectPopover } from "../composer/BranchSelectPopover.js";
import type { ThreadSummaryViewModel } from "./threadSummaryViewModel.js";
import { previewThreadSummarySources } from "./threadSummaryViewModel.js";
import type { OpenPlanInDockRequest } from "../workflow/WorkflowPlanCard.js";

type ThreadSummaryActions = {
  onBranchSelect: (branch: string) => Promise<void>;
  onCommitOrPush: () => void;
  onCreateBranch: () => void;
  onCreatePullRequest: () => void;
  onOpenPlan: (plan: OpenPlanInDockRequest) => void;
  onOpenReview: () => void;
  onOpenSubagent?: (taskId: string) => void;
  onOpenWorkspacePath: () => void;
};

type ThreadSummaryPanelProps = ThreadSummaryActions & {
  branches: string[];
  model: ThreadSummaryViewModel;
};

export function ThreadSummaryPopover({
  children,
  open,
  panel,
  onOpenChange,
}: {
  children: React.ReactElement;
  open: boolean;
  panel: React.ReactNode;
  onOpenChange: (open: boolean) => void;
}): React.ReactNode {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          aria-label="置顶摘要"
          className="thread-summary-popover"
          collisionPadding={12}
          side="bottom"
          sideOffset={8}
        >
          {panel}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ThreadSummaryInline({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="thread-summary-inline" data-testid="thread-summary-inline">
      {children}
    </div>
  );
}

export class ThreadSummaryErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; retryKey: number }
> {
  state = { failed: false, retryKey: 0 };

  static getDerivedStateFromError(): Partial<{
    failed: boolean;
    retryKey: number;
  }> {
    return { failed: true };
  }

  retry = (): void => {
    this.setState((state) => ({
      failed: false,
      retryKey: state.retryKey + 1,
    }));
  };

  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <section
          aria-label="摘要加载失败"
          className="thread-summary-error"
          role="alert"
        >
          <strong>摘要暂时无法显示</strong>
          <span>会话本身不受影响。</span>
          <button type="button" onClick={this.retry}>
            <RefreshCcw size={APP_ICON_SIZE} />
            重试
          </button>
        </section>
      );
    }
    return (
      <React.Fragment key={this.state.retryKey}>
        {this.props.children}
      </React.Fragment>
    );
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
  const [branchPopoverOpen, setBranchPopoverOpen] = React.useState(false);
  const [branchSearch, setBranchSearch] = React.useState("");
  const [sourcesPanelOpen, setSourcesPanelOpen] = React.useState(false);
  const sourcePreview = previewThreadSummarySources(model.sources);
  const sourceListId = React.useId();
  const changes = model.changes ?? {
    additions: 0,
    deletions: 0,
    fileCount: 0,
  };
  const hasChanges =
    changes.fileCount > 0 || changes.additions > 0 || changes.deletions > 0;

  return (
    <aside className="thread-summary-panel" aria-label="置顶摘要">
      {model.environment ? (
        <ThreadSummarySection
          collapsedSummary={
            hasChanges ? (
              <span className="thread-summary-diff">
                <strong>+{changes.additions}</strong>
                <em>-{changes.deletions}</em>
              </span>
            ) : null
          }
          first
          title="环境信息"
          actionLabel="暂不支持创建本地环境"
        >
          <button
            className="thread-summary-row"
            title="打开变更审查"
            type="button"
            onClick={onOpenReview}
          >
            <SquarePlus aria-hidden="true" size={APP_ICON_SIZE} />
            <span>变更</span>
            {hasChanges ? (
              <small className="thread-summary-change-summary">
                <span className="thread-summary-diff">
                  <strong>+{changes.additions}</strong>
                  <em>-{changes.deletions}</em>
                </span>
              </small>
            ) : null}
          </button>
          <div
            className="thread-summary-row-group"
            title={model.environment.workspacePath}
          >
            <button
              className="thread-summary-row-group__main"
              type="button"
              onClick={onOpenWorkspacePath}
            >
              <Laptop aria-hidden="true" size={APP_ICON_SIZE} />
              <span>本地</span>
            </button>
            <DisabledSummaryControl label="暂不支持切换执行位置">
              <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />
            </DisabledSummaryControl>
          </div>
          <BranchSelectPopover
            align="start"
            branchSearch={branchSearch}
            branches={branches}
            className="popover-thread-summary-branch"
            currentBranchDetail={`未提交：${model.environment.changedFileCount} 个文件`}
            currentBranchName={model.environment.branchName ?? ""}
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
                className="thread-summary-row"
                data-state={branchPopoverOpen ? "open" : "closed"}
                title={model.environment.branchName ?? "未检测到 Git 分支"}
                type="button"
              >
                <GitBranch aria-hidden="true" size={APP_ICON_SIZE} />
                <span>
                  {model.environment.branchName ?? "未检测到 Git 分支"}
                </span>
                <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />
              </button>
            }
          />
          <SummaryGitActionRow
            enabled={model.environment.commitOrPushEnabled}
            disabledReason={
              model.environment.commitOrPushDisabledReason ??
              "当前工作区不可执行 Git 操作"
            }
            icon={<GitCommitHorizontal aria-hidden="true" size={APP_ICON_SIZE} />}
            label="提交或推送"
            onClick={onCommitOrPush}
          />
          <SummaryGitActionRow
            enabled={model.environment.createPullRequestEnabled}
            disabledReason={
              model.environment.createPullRequestDisabledReason ??
              "当前分支不可创建拉取请求"
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
            className="thread-summary-row"
            type="button"
            onClick={() => onOpenPlan(model.plan!)}
          >
            <ListChecks aria-hidden="true" size={APP_ICON_SIZE} />
            <span>{model.plan.title}</span>
          </button>
        </ThreadSummarySection>
      ) : null}

      {sourcePreview.items.length ? (
        <ThreadSummarySection
          title="来源"
          actionLabel="暂不支持手动添加来源"
          rowsId={sourceListId}
        >
          {sourcePreview.items.map((source) => (
            <a
              className="thread-summary-row"
              href={source.url}
              key={source.url}
              rel="noreferrer"
              target="_blank"
              title={source.url}
            >
              <Link2 aria-hidden="true" size={APP_ICON_SIZE} />
              <span>{source.label}</span>
            </a>
          ))}
          <button
            aria-haspopup="dialog"
            className="thread-summary-row thread-summary-source-toggle"
            type="button"
            onClick={() => setSourcesPanelOpen(true)}
          >
            <Link2 aria-hidden="true" size={APP_ICON_SIZE} />
            <span>查看全部</span>
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
  );
}

function ThreadSummarySubagentsRow({
  subagents,
}: {
  subagents: ThreadSummaryViewModel["subagents"];
}): React.ReactNode {
  const activeCount = subagents.filter(
    (subagent) => !isFinishedSubagentStatus(subagent.status),
  ).length;
  const finishedCount = subagents.length - activeCount;
  const label =
    activeCount > 0 ? `${activeCount} 正在运行` : `${finishedCount} 完成`;

  return (
    <div
      aria-label={`子智能体：${label}`}
      className="thread-summary-row thread-summary-subagents-summary"
      title={subagents.map((subagent) => subagent.name).join("、")}
    >
      <span className="thread-summary-subagents-summary__avatars">
        {subagents.slice(0, 4).map((subagent) => (
          <span aria-hidden="true" key={subagent.id}>
            <Bot size={12} />
          </span>
        ))}
      </span>
      <span>{label}</span>
      {activeCount > 0 && finishedCount > 0 ? (
        <small>{finishedCount} 完成</small>
      ) : null}
    </div>
  );
}

function ThreadSummarySourcesPanel({
  open,
  sources,
  onOpenChange,
}: {
  open: boolean;
  sources: ThreadSummaryViewModel["sources"];
  onOpenChange: (open: boolean) => void;
}): React.ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="thread-summary-sources-overlay" />
        <Dialog.Content className="thread-summary-sources-panel">
          <header>
            <div>
              <Dialog.Title>来源</Dialog.Title>
              <span>{sources.length}</span>
            </div>
            <Dialog.Close aria-label="关闭来源面板" type="button">
              <X aria-hidden="true" size={APP_ICON_SIZE} />
            </Dialog.Close>
          </header>
          <Dialog.Description>
            当前会话中已识别的文件与网页来源。
          </Dialog.Description>
          <div className="thread-summary-sources-panel__list" role="list">
            {sources.map((source) => (
              <a
                href={source.url}
                key={source.url}
                rel="noreferrer"
                role="listitem"
                target="_blank"
                title={source.url}
              >
                <Link2 aria-hidden="true" size={APP_ICON_SIZE} />
                <span>{source.label}</span>
              </a>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ThreadSummarySection({
  actionLabel,
  children,
  collapsedSummary,
  first = false,
  rowsId,
  title,
}: {
  actionLabel?: string;
  children: React.ReactNode;
  collapsedSummary?: React.ReactNode;
  first?: boolean;
  rowsId?: string;
  title: string;
}): React.ReactNode {
  const headingId = React.useId();
  const [expanded, setExpanded] = React.useState(true);
  return (
    <section
      aria-labelledby={headingId}
      className={
        first
          ? "thread-summary-section thread-summary-section--first"
          : "thread-summary-section"
      }
    >
      <header>
        <h2>
          <button
            aria-expanded={expanded}
            className="thread-summary-section__toggle"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            <span id={headingId}>{title}</span>
            {!expanded ? collapsedSummary : null}
            <ChevronDown aria-hidden="true" size={12} />
          </button>
        </h2>
        <span className="thread-summary-section__actions">
          {actionLabel ? (
            <DisabledSummaryControl label={actionLabel}>
              <Plus aria-hidden="true" size={APP_ICON_SIZE} />
            </DisabledSummaryControl>
          ) : null}
        </span>
      </header>
      <div
        aria-hidden={!expanded}
        className="thread-summary-section__content"
        data-expanded={expanded}
        inert={!expanded}
      >
        <div className="thread-summary-section__rows" id={rowsId}>
          {children}
        </div>
      </div>
    </section>
  );
}

function DisabledSummaryControl({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}): React.ReactNode {
  return (
    <Tooltip content={label} side="left">
      <button
        aria-disabled="true"
        aria-label={label}
        className="thread-summary-disabled-control"
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function SummaryGitActionRow({
  disabledReason,
  enabled,
  icon,
  label,
  onClick,
}: {
  disabledReason: string;
  enabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactNode {
  const row = (
    <button
      aria-disabled={!enabled}
      className="thread-summary-row"
      type="button"
      onClick={(event) => {
        if (!enabled) {
          event.preventDefault();
          return;
        }
        onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return enabled ? row : <Tooltip content={disabledReason}>{row}</Tooltip>;
}

function isFinishedSubagentStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "stopped" ||
    status === "interrupted"
  );
}
