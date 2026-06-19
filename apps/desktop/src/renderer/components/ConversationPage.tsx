import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  Archive,
  ChevronRight,
  Columns2,
  Code2,
  Copy,
  FileDiff,
  GitBranch,
  GitPullRequest,
  Laptop,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  RotateCcw,
  Settings,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Workflow,
} from "lucide-react";
import { legacyMessagesToSessionEvents } from "../../shared/sessionEventModel.js";
import type {
  DesktopGitStatus,
  DesktopSessionEvent,
} from "../../shared/types.js";
import { useQuickChatContext } from "../context/QuickChatContext.js";
import type { Message } from "../uiTypes.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { PopoverItem } from "./ui/PopoverItem.js";
import { PopoverMenu } from "./ui/PopoverMenu.js";
import { Tooltip } from "./ui/Tooltip.js";

export function ConversationPage(): React.ReactNode {
  const {
    isConversationLoading,
    activeSessionId,
    activeSessionPinnedAt,
    sessionTitle,
    events,
    messages,
    sessionStatus,
    workspacePath,
    branchName,
    diff,
    gitStatus,
    onArchiveSession,
    onCreateBranch,
    onOpenAutomation,
    onOpenWorkspacePath,
    onRefreshDiff,
    onToggleSessionPinned,
    onCommitOrPush,
    onCreatePullRequest,
    composer,
  } = useQuickChatContext();

  const conversationMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const timelineEvents = React.useMemo(
    () =>
      foldTimelineEvents(
        events.length > 0
          ? events
          : legacyMessagesToSessionEvents("legacy", conversationMessages),
      ),
    [conversationMessages, events],
  );
  const showThinking =
    (sessionStatus === "running" || sessionStatus === "waiting") &&
    !timelineEvents.some(
      (event) =>
        (event.type === "message" || event.type === "assistant_delta") &&
        event.role === "assistant" &&
        Boolean(event.content?.trim()),
    );
  const showEnvironmentPanel = Boolean(workspacePath);
  const showComposerChangeSummary = Boolean(
    workspacePath && gitStatus && gitStatus.files.length > 0,
  );
  const composerDiffSummary = summarizeDiff(diff);
  const fallbackTitle = React.useMemo(
    () => getConversationTitle(timelineEvents),
    [timelineEvents],
  );
  const renderedSessionTitle = sessionTitle ?? fallbackTitle;
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const hasActiveSession = Boolean(activeSessionId);
  const isSessionPinned = Boolean(activeSessionPinnedAt);

  function closeSessionMenu(): void {
    setSessionMenuOpen(false);
  }

  function copyText(text: string): void {
    closeSessionMenu();
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  function copySessionDeepLink(): void {
    if (!activeSessionId) return;
    const url = new URL(window.location.href);
    url.pathname = `/sessions/${encodeURIComponent(activeSessionId)}`;
    url.search = "";
    url.hash = "";
    copyText(url.toString());
  }

  function openBranchFlow(): void {
    closeSessionMenu();
    onCreateBranch();
  }

  function openAutomationView(): void {
    closeSessionMenu();
    onOpenAutomation();
  }

  function toggleSessionPinned(): void {
    closeSessionMenu();
    onToggleSessionPinned();
  }

  function archiveCurrentSession(): void {
    closeSessionMenu();
    onArchiveSession();
  }

  return (
    <section className="conversation-page">
      <header className="chat-session-header">
        <div className="chat-session-title">
          <span>
            {isConversationLoading ? "加载对话中" : renderedSessionTitle}
          </span>
          <PopoverMenu
            align="start"
            className="popover-session-actions"
            open={sessionMenuOpen}
            trigger={
              <button
                aria-label="更多会话操作"
                className="message-action"
                title="更多操作"
                type="button"
              >
                <MoreHorizontal size={16} />
              </button>
            }
            onOpenChange={setSessionMenuOpen}
          >
            <PopoverItem
              icon={<Pin size={14} />}
              shortcut="Ctrl+Alt+P"
              disabled={!hasActiveSession}
              onClick={toggleSessionPinned}
            >
              {isSessionPinned ? "取消置顶" : "置顶对话"}
            </PopoverItem>
            <PopoverItem
              disabled
              icon={<Pencil size={14} />}
              shortcut="Ctrl+Alt+R"
            >
              重命名对话
            </PopoverItem>
            <PopoverItem
              disabled={!hasActiveSession}
              icon={<Archive size={14} />}
              shortcut="Ctrl+Shift+A"
              onClick={archiveCurrentSession}
            >
              归档对话
            </PopoverItem>
            <div className="popover-divider" />
            <PopoverItem
              disabled
              icon={<MessageSquarePlus size={14} />}
            >
              打开侧边聊天
            </PopoverItem>
            <SessionSubmenu
              disabled={!hasActiveSession && !workspacePath}
              icon={<Copy size={14} />}
              label="复制"
            >
              <PopoverItem
                disabled={!workspacePath}
                icon={<Copy size={14} />}
                shortcut="Ctrl+Shift+C"
                onClick={() => copyText(workspacePath ?? "")}
              >
                复制工作目录
              </PopoverItem>
              <PopoverItem
                disabled={!hasActiveSession}
                icon={<Copy size={14} />}
                shortcut="Ctrl+Alt+C"
                onClick={() => copyText(activeSessionId ?? "")}
              >
                复制会话 ID
              </PopoverItem>
              <PopoverItem
                disabled={!hasActiveSession}
                icon={<Copy size={14} />}
                shortcut="Ctrl+Alt+L"
                onClick={copySessionDeepLink}
              >
                复制深度链接
              </PopoverItem>
            </SessionSubmenu>
            <SessionSubmenu
              disabled={!workspacePath}
              icon={<GitBranch size={14} />}
              label="分支"
            >
              <PopoverItem
                icon={<Laptop size={14} />}
                onClick={openBranchFlow}
              >
                派生到本地
              </PopoverItem>
              <PopoverItem disabled icon={<GitBranch size={14} />}>
                派生到新工作树
              </PopoverItem>
            </SessionSubmenu>
            <PopoverItem
              icon={<Workflow size={14} />}
              onClick={openAutomationView}
            >
              添加自动化...
            </PopoverItem>
            <div className="popover-divider" />
            <PopoverItem
              disabled
              icon={<AppWindow size={14} />}
            >
              在新窗口中打开
            </PopoverItem>
          </PopoverMenu>
        </div>
        <div className="chat-session-actions">
          <Tooltip content="在编辑器中打开">
            <button
              aria-label="在编辑器中打开"
              className="message-action"
              type="button"
            >
              <Code2 size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>
          <Tooltip content="分屏">
            <button aria-label="分屏" className="message-action" type="button">
              <Columns2 size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>
          <Tooltip content="展开">
            <button aria-label="展开" className="message-action" type="button">
              <Maximize2 size={15} strokeWidth={1.8} />
            </button>
          </Tooltip>
        </div>
      </header>

      <div
        className={`quick-chat-workspace ${
          showEnvironmentPanel ? "with-environment-panel" : ""
        }`}
      >
        <div className="quick-chat-content">
          <div className="conversation-stream">
            {isConversationLoading ? (
              <div className="assistant-thinking">加载对话中</div>
            ) : (
              timelineEvents.map((event) => (
                <TimelineEvent event={event} key={event.id} />
              ))
            )}
            {!isConversationLoading && showThinking ? <ThinkingPill /> : null}
          </div>
        </div>
        {!isConversationLoading && showEnvironmentPanel ? (
          <EnvironmentPanel
            branchName={branchName}
            diff={diff}
            gitStatus={gitStatus}
            workspacePath={workspacePath}
            onCommitOrPush={onCommitOrPush}
            onCreateBranch={onCreateBranch}
            onCreatePullRequest={onCreatePullRequest}
            onOpenWorkspacePath={onOpenWorkspacePath}
            onRefreshDiff={onRefreshDiff}
          />
        ) : null}
      </div>

      {composer ? (
        <div className="chat-composer">
          {showComposerChangeSummary ? (
            <div className="composer-change-summary">
              <span>
                {gitStatus?.files.length ?? 0} 个文件已更改
                <strong> +{formatPanelNumber(composerDiffSummary.additions)}</strong>
                <em> -{formatPanelNumber(composerDiffSummary.deletions)}</em>
              </span>
              <button type="button">审查</button>
            </div>
          ) : null}
          {composer}
        </div>
      ) : null}
    </section>
  );
}

function SessionSubmenu({
  children,
  disabled,
  icon,
  label,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}): React.ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className="popover-item popover-sub-trigger"
        disabled={disabled}
        tabIndex={-1}
      >
        <span className="popover-item-icon">{icon}</span>
        <span className="popover-item-label">{label}</span>
        <ChevronRight className="popover-item-arrow" size={14} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          alignOffset={-6}
          className="popover popover-sub-content popover-auto-width"
          sideOffset={8}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function TimelineEvent({
  event,
}: {
  event: DesktopSessionEvent;
}): React.ReactNode {
  if (event.type === "message" || event.type === "assistant_delta") {
    return (
      <ChatMessage
        message={{
          id: event.id,
          role: event.role ?? "system",
          text: event.content ?? "",
          createdAt: event.createdAt,
          streaming: event.type === "assistant_delta",
        }}
      />
    );
  }

  if (event.type === "tool_call" || event.type === "tool_result") {
    const toolName = stringMetadata(event, "toolName") ?? "Tool";
    const isError =
      event.type === "tool_result" && event.metadata?.isError === true;
    return (
      <details className={`timeline-tool-event ${isError ? "error" : ""}`}>
        <summary>
          <span>{event.type === "tool_call" ? "Running" : "Result"}</span>
          <strong>{toolName}</strong>
        </summary>
        {event.content ? <pre>{event.content}</pre> : null}
      </details>
    );
  }

  if (event.type === "file_patch") {
    const files = Array.isArray(event.metadata?.files)
      ? (event.metadata.files as Array<Record<string, unknown>>)
      : [];
    const additions = numberMetadata(event, "additions");
    const deletions = numberMetadata(event, "deletions");
    return (
      <article className="timeline-file-event">
        <div className="timeline-event-title">
          <FileDiff size={14} />
          <span>{event.content ?? "Edited files"}</span>
          {additions !== null || deletions !== null ? (
            <small>
              +{additions ?? 0} -{deletions ?? 0}
            </small>
          ) : null}
        </div>
        {files.length > 0 ? (
          <ul>
            {files.slice(0, 6).map((file, index) => (
              <li key={`${String(file.path ?? "file")}-${index}`}>
                <span>{String(file.path ?? "file")}</span>
                <small>
                  +{Number(file.additions ?? 0)} -{Number(file.deletions ?? 0)}
                </small>
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    );
  }

  if (event.type === "permission_request" || event.type === "error") {
    return (
      <article className={`timeline-system-event ${event.type}`}>
        {event.content}
      </article>
    );
  }

  if (event.type === "status" || event.type === "checkpoint") {
    return null;
  }

  return null;
}

function ChatMessage({ message }: { message: Message }): React.ReactNode {
  if (message.role === "user") {
    return (
      <article className="chat-message-row user">
        <div className="user-message-bubble">{message.text}</div>
        <MessageActionButton label="复制" tip="复制" text={message.text}>
          <Copy size={14} />
        </MessageActionButton>
      </article>
    );
  }

  return (
    <article className={`chat-message-row ${message.role}`}>
      <div className="assistant-message-body">
        <MarkdownMessage
          text={message.text}
          streaming={Boolean(message.streaming)}
        />
      </div>
      {message.role === "assistant" && message.text.trim() ? (
        <div className="assistant-message-actions">
          <MessageActionButton label="复制" tip="复制" text={message.text}>
            <Copy size={14} />
          </MessageActionButton>
          <Tooltip content="赞">
            <button aria-label="赞" className="message-action" type="button">
              <ThumbsUp size={14} />
            </button>
          </Tooltip>
          <Tooltip content="踩">
            <button aria-label="踩" className="message-action" type="button">
              <ThumbsDown size={14} />
            </button>
          </Tooltip>
          <Tooltip content="重新生成">
            <button
              aria-label="重新生成"
              className="message-action"
              type="button"
            >
              <RotateCcw size={14} />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </article>
  );
}

function MessageActionButton({
  children,
  label,
  tip,
  text,
}: {
  children: React.ReactNode;
  label: string;
  tip: string;
  text: string;
}): React.ReactNode {
  return (
    <Tooltip content={tip}>
      <button
        aria-label={label}
        className="message-action"
        onClick={() => {
          void navigator.clipboard?.writeText(text).catch(() => undefined);
        }}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function getConversationTitle(
  events: Array<{ role?: string; content?: string }>,
): string {
  const firstUserMessage = events.find((event) => event.role === "user");
  const title = firstUserMessage?.content?.trim().split(/\r?\n/)[0] ?? "新对话";
  return title.length > 28 ? `${title.slice(0, 28)}...` : title;
}

function EnvironmentPanel({
  branchName,
  diff,
  gitStatus,
  workspacePath,
  onCommitOrPush,
  onCreateBranch,
  onCreatePullRequest,
  onOpenWorkspacePath,
  onRefreshDiff,
}: {
  branchName: string | null;
  diff: string;
  gitStatus: DesktopGitStatus | null;
  workspacePath: string | null;
  onCommitOrPush: () => void;
  onCreateBranch: () => void;
  onCreatePullRequest: () => void;
  onOpenWorkspacePath: () => void;
  onRefreshDiff: () => void;
}): React.ReactNode {
  const [showDiff, setShowDiff] = React.useState(false);
  const diffSummary = summarizeDiff(diff);
  const gitLabel = branchName?.trim() || "未检测到 Git 分支";
  const changedFileCount = gitStatus?.files.length ?? 0;

  return (
    <aside className="environment-panel" aria-label="环境信息">
      <div className="environment-panel-header">
        <span>环境信息</span>
        <button aria-label="环境设置" className="message-action" type="button">
          <Settings size={16} />
        </button>
      </div>

      <div className="environment-action-list">
        <button
          className="environment-action-row"
          type="button"
          onClick={() => {
            onRefreshDiff();
            setShowDiff((current) => !current);
          }}
        >
          <FileDiff size={16} />
          <span>变更{changedFileCount ? ` (${changedFileCount})` : ""}</span>
          <span className="environment-diff-counts">
            <strong>+{formatPanelNumber(diffSummary.additions)}</strong>
            <em>-{formatPanelNumber(diffSummary.deletions)}</em>
          </span>
        </button>
        {showDiff ? <pre className="environment-diff-preview">{diff}</pre> : null}
        <button
          className="environment-action-row"
          type="button"
          onClick={onOpenWorkspacePath}
        >
          <Laptop size={16} />
          <span>本地</span>
          <ChevronRight className="environment-row-chevron" size={13} />
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCreateBranch}
        >
          <GitBranch size={16} />
          <span title={gitLabel}>{gitLabel}</span>
          <ChevronRight className="environment-row-chevron" size={13} />
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCommitOrPush}
        >
          <Upload size={16} />
          <span>提交或推送</span>
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCreatePullRequest}
        >
          <GitPullRequest size={16} />
          <span>创建拉取请求</span>
        </button>
      </div>

      <div className="environment-source">
        <span>来源</span>
        <small title={workspacePath ?? undefined}>
          {workspacePath ? "本地项目" : "暂无来源"}
        </small>
      </div>
    </aside>
  );
}

function foldTimelineEvents(
  sourceEvents: DesktopSessionEvent[],
): DesktopSessionEvent[] {
  const folded: DesktopSessionEvent[] = [];
  for (const event of sourceEvents) {
    const previous = folded.at(-1);
    if (event.type === "assistant_delta") {
      if (previous?.type === "assistant_delta") {
        folded[folded.length - 1] = event;
      } else {
        folded.push(event);
      }
      continue;
    }
    if (
      event.type === "message" &&
      event.role === "assistant" &&
      previous?.type === "assistant_delta"
    ) {
      folded[folded.length - 1] = event;
      continue;
    }
    folded.push(event);
  }
  return folded;
}

function stringMetadata(
  event: DesktopSessionEvent,
  key: string,
): string | null {
  const value = event.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function numberMetadata(
  event: DesktopSessionEvent,
  key: string,
): number | null {
  const value = event.metadata?.[key];
  return typeof value === "number" ? value : null;
}

function summarizeDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function formatPanelNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function ThinkingPill(): React.ReactNode {
  const [seconds, setSeconds] = React.useState(0);

  React.useEffect(() => {
    setSeconds(0);
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return (
    <button className="chat-thinking-pill" type="button">
      <Sparkles size={12} />
      <span>已处理 {formatDuration(seconds)}</span>
      <ChevronRight size={12} />
    </button>
  );
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
