import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Bot,
  ChevronDown,
  ExternalLink,
  FileDiff,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Laptop,
  ListChecks,
  RefreshCcw,
  Upload,
} from "lucide-react";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { BranchSelectPopover } from "./BranchSelectPopover.js";
import type {
  ThreadSummaryViewModel,
} from "./threadSummaryViewModel.js";
import { visibleThreadSummarySources } from "./threadSummaryViewModel.js";

type ThreadSummaryActions = {
  onBranchSelect: (branch: string) => Promise<void>;
  onCommitOrPush: () => void;
  onCreateBranch: () => void;
  onCreatePullRequest: () => void;
  onOpenPlan: (plan: { title: string; content: string }) => void;
  onOpenReview: () => void;
  onOpenSubagent: (taskId: string) => void;
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
  onOpenSubagent,
  onOpenWorkspacePath,
}: ThreadSummaryPanelProps): React.ReactNode {
  const [branchPopoverOpen, setBranchPopoverOpen] = React.useState(false);
  const [branchSearch, setBranchSearch] = React.useState("");
  const [sourcesExpanded, setSourcesExpanded] = React.useState(false);
  const sourceDisplay = visibleThreadSummarySources(
    model.sources,
    sourcesExpanded,
  );

  return (
    <aside className="thread-summary-panel" aria-label="置顶摘要">
      <header className="thread-summary-panel__header">
        <strong>摘要</strong>
        <span>当前会话</span>
      </header>

      {model.environment ? (
        <ThreadSummarySection title="环境">
          <button
            className="thread-summary-row"
            title={model.environment.workspacePath}
            type="button"
            onClick={onOpenWorkspacePath}
          >
            <FolderOpen size={APP_ICON_SIZE} />
            <span>{model.environment.workspaceName}</span>
            <ExternalLink className="thread-summary-row__action" size={13} />
          </button>
          <button
            className="thread-summary-row"
            type="button"
            onClick={onOpenWorkspacePath}
          >
            <Laptop size={APP_ICON_SIZE} />
            <span>本地</span>
            <ExternalLink className="thread-summary-row__action" size={13} />
          </button>
          <BranchSelectPopover
            align="start"
            branchSearch={branchSearch}
            branches={branches}
            className="popover-environment-branch"
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
                title={model.environment.branchName ?? "未检测到 Git 分支"}
                type="button"
              >
                <GitBranch size={APP_ICON_SIZE} />
                <span>
                  {model.environment.branchName ?? "未检测到 Git 分支"}
                </span>
                <ChevronDown
                  className="thread-summary-row__action"
                  size={13}
                />
              </button>
            }
          />
          <div className="thread-summary-inline-actions">
            <button type="button" onClick={onCommitOrPush}>
              <Upload size={13} />
              提交或推送
            </button>
            <button type="button" onClick={onCreatePullRequest}>
              <GitPullRequest size={13} />
              创建 PR
            </button>
          </div>
        </ThreadSummarySection>
      ) : null}

      {model.changes ? (
        <ThreadSummarySection title="变更">
          <button
            className="thread-summary-row"
            type="button"
            onClick={onOpenReview}
          >
            <FileDiff size={APP_ICON_SIZE} />
            <span>
              {model.changes.fileCount} 个文件
              <small className="thread-summary-diff">
                <strong>+{model.changes.additions}</strong>
                <em>-{model.changes.deletions}</em>
              </small>
            </span>
            <ExternalLink className="thread-summary-row__action" size={13} />
          </button>
        </ThreadSummarySection>
      ) : null}

      {model.plan ? (
        <ThreadSummarySection title="计划">
          <button
            className="thread-summary-row"
            type="button"
            onClick={() => onOpenPlan(model.plan!)}
          >
            <ListChecks size={APP_ICON_SIZE} />
            <span>{model.plan.title}</span>
            <ExternalLink className="thread-summary-row__action" size={13} />
          </button>
        </ThreadSummarySection>
      ) : null}

      {sourceDisplay.items.length ? (
        <ThreadSummarySection
          title="来源"
          trailing={
            sourceDisplay.canExpand ? (
              <button
                aria-expanded={sourcesExpanded}
                className="thread-summary-section__toggle"
                type="button"
                onClick={() => setSourcesExpanded((current) => !current)}
              >
                {sourcesExpanded ? "收起" : `展开 ${model.sources.length}`}
              </button>
            ) : null
          }
        >
          {sourceDisplay.items.map((source) => (
            <a
              className="thread-summary-row"
              href={source.url}
              key={source.url}
              rel="noreferrer"
              target="_blank"
              title={source.url}
            >
              <ExternalLink size={APP_ICON_SIZE} />
              <span>{source.label}</span>
              <ExternalLink className="thread-summary-row__action" size={13} />
            </a>
          ))}
        </ThreadSummarySection>
      ) : null}

      {model.subagents.length ? (
        <ThreadSummarySection title="子智能体">
          {model.subagents.map((subagent) => (
            <button
              className="thread-summary-row"
              key={subagent.id}
              type="button"
              onClick={() => onOpenSubagent(subagent.id)}
            >
              <Bot size={APP_ICON_SIZE} />
              <span>{subagent.name}</span>
              <small>{subagentStatusLabel(subagent.status)}</small>
            </button>
          ))}
        </ThreadSummarySection>
      ) : null}
    </aside>
  );
}

function ThreadSummarySection({
  children,
  title,
  trailing,
}: {
  children: React.ReactNode;
  title: string;
  trailing?: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="thread-summary-section">
      <header>
        <span>{title}</span>
        {trailing}
      </header>
      <div className="thread-summary-section__rows">{children}</div>
    </section>
  );
}

function subagentStatusLabel(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "stopped") return "已停止";
  if (status === "interrupted") return "已中断";
  if (status === "queued") return "排队中";
  if (status === "waiting-question") return "等待回答";
  if (status === "waiting-permission") return "等待审批";
  if (status === "steering") return "调整中";
  return "运行中";
}
