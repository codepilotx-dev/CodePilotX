import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  Archive,
  ChevronDown,
  ChevronRight,
  Columns2,
  Code2,
  Copy,
  File,
  FileDiff,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Laptop,
  MessageSquarePlus,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Pencil,
  Pin,
  RotateCcw,
  Settings,
  Sparkles,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Workflow,
} from "lucide-react";
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './ui/iconTokens.js'
import { legacyMessagesToSessionEvents } from "../../shared/sessionEventModel.js";
import type {
  DesktopGitStatus,
  DesktopOpenTarget,
  DesktopSessionEvent,
} from "../../shared/types.js";
import { useQuickChatContext } from "../context/QuickChatContext.js";
import { useDesktopSettings } from "../features/settings/useDesktopSettings.js";
import { desktopClient } from "../services/desktopClient.js";
import type { Message } from "../uiTypes.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { PopoverItem } from "./ui/PopoverItem.js";
import { PopoverMenu } from "./ui/PopoverMenu.js";
import { Tooltip } from "./ui/Tooltip.js";

const FALLBACK_OPEN_TARGETS: DesktopOpenTarget[] = [
  {
    id: "default-app",
    label: "Default app",
    kind: "default-app",
  },
  {
    id: "file-explorer",
    label: "File Explorer",
    kind: "file-explorer",
  },
  {
    id: "terminal",
    label: "Terminal",
    kind: "terminal",
  },
];

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
  const { defaultOpenTargetId, setDefaultOpenTargetId } = useDesktopSettings();

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
  const timelineItems = React.useMemo(
    () => groupTimelineToolEvents(timelineEvents),
    [timelineEvents],
  );
  const showThinking =
    (sessionStatus === "running" || sessionStatus === "waiting") &&
    !timelineEvents.some(
      (event) =>
        (event.type === "message" || event.type === "assistant_delta") &&
        event.role === "assistant" &&
        Boolean(event.content?.trim()),
    );
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const [openTargetMenuOpen, setOpenTargetMenuOpen] = React.useState(false);
  const [openTargets, setOpenTargets] =
    React.useState<DesktopOpenTarget[]>(FALLBACK_OPEN_TARGETS);
  const [showPinnedSummary, setShowPinnedSummary] = React.useState(true);
  const [bottomPanelVisible, setBottomPanelVisible] = React.useState(false);
  const [rightSidebarVisible, setRightSidebarVisible] = React.useState(false);
  const showEnvironmentPanel = Boolean(workspacePath && showPinnedSummary);
  const showComposerChangeSummary = Boolean(
    workspacePath && gitStatus && gitStatus.files.length > 0,
  );
  const composerDiffSummary = summarizeDiff(diff);
  const fallbackTitle = React.useMemo(
    () => getConversationTitle(timelineEvents),
    [timelineEvents],
  );
  const renderedSessionTitle = sessionTitle ?? fallbackTitle;
  const hasActiveSession = Boolean(activeSessionId);
  const isSessionPinned = Boolean(activeSessionPinnedAt);
  const selectedOpenTarget =
    openTargets.find((target) => target.id === defaultOpenTargetId) ??
    FALLBACK_OPEN_TARGETS[0];

  React.useEffect(() => {
    let mounted = true;
    void desktopClient
      .listOpenTargets()
      .then((targets) => {
        if (!mounted) return;
        setOpenTargets(targets.length ? targets : FALLBACK_OPEN_TARGETS);
      })
      .catch(() => {
        if (mounted) {
          setOpenTargets(FALLBACK_OPEN_TARGETS);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

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

  function openWorkspaceWithDefaultTarget(): void {
    if (!workspacePath) return;
    onOpenWorkspacePath();
  }

  function selectOpenTarget(targetId: string): void {
    if (!workspacePath) return;
    setOpenTargetMenuOpen(false);
    setDefaultOpenTargetId(targetId);
    void desktopClient
      .getDesktopSettings()
      .then((settings) =>
        desktopClient.saveDesktopSettings({
          ...settings,
          defaultOpenTargetId: targetId,
        }),
      )
      .catch(() => undefined)
      .then(() => {
        onOpenWorkspacePath();
      });
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
                <MoreHorizontal size={APP_ICON_SIZE} />
              </button>
            }
            onOpenChange={setSessionMenuOpen}
          >
            <PopoverItem
              icon={<Pin size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+P"
              disabled={!hasActiveSession}
              onClick={toggleSessionPinned}
            >
              {isSessionPinned ? "取消置顶" : "置顶对话"}
            </PopoverItem>
            <PopoverItem
              disabled
              icon={<Pencil size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+R"
            >
              重命名对话
            </PopoverItem>
            <PopoverItem
              disabled={!hasActiveSession}
              icon={<Archive size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Shift+A"
              onClick={archiveCurrentSession}
            >
              归档对话
            </PopoverItem>
            <div className="popover-divider" />
            <PopoverItem
              disabled
              icon={<MessageSquarePlus size={APP_ICON_SIZE} />}
            >
              打开侧边聊天
            </PopoverItem>
            <SessionSubmenu
              disabled={!hasActiveSession && !workspacePath}
              icon={<Copy size={APP_ICON_SIZE} />}
              label="复制"
            >
              <PopoverItem
                disabled={!workspacePath}
                icon={<Copy size={APP_ICON_SIZE} />}
                shortcut="Ctrl+Shift+C"
                onClick={() => copyText(workspacePath ?? "")}
              >
                复制工作目录
              </PopoverItem>
              <PopoverItem
                disabled={!hasActiveSession}
                icon={<Copy size={APP_ICON_SIZE} />}
                shortcut="Ctrl+Alt+C"
                onClick={() => copyText(activeSessionId ?? "")}
              >
                复制会话 ID
              </PopoverItem>
              <PopoverItem
                disabled={!hasActiveSession}
                icon={<Copy size={APP_ICON_SIZE} />}
                shortcut="Ctrl+Alt+L"
                onClick={copySessionDeepLink}
              >
                复制深度链接
              </PopoverItem>
            </SessionSubmenu>
            <SessionSubmenu
              disabled={!workspacePath}
              icon={<GitBranch size={APP_ICON_SIZE} />}
              label="分支"
            >
              <PopoverItem
                icon={<Laptop size={APP_ICON_SIZE} />}
                onClick={openBranchFlow}
              >
                派生到本地
              </PopoverItem>
              <PopoverItem disabled icon={<GitBranch size={APP_ICON_SIZE} />}>
                派生到新工作树
              </PopoverItem>
            </SessionSubmenu>
            <PopoverItem
              icon={<Workflow size={APP_ICON_SIZE} />}
              onClick={openAutomationView}
            >
              添加自动化...
            </PopoverItem>
            <div className="popover-divider" />
            <PopoverItem
              disabled
              icon={<AppWindow size={APP_ICON_SIZE} />}
            >
              在新窗口中打开
            </PopoverItem>
          </PopoverMenu>
        </div>
        <div className="chat-session-actions">
          <div className="open-target-split-button">
            <Tooltip content={`用 ${selectedOpenTarget.label} 打开`}>
              <button
                aria-label={`用 ${selectedOpenTarget.label} 打开`}
                className="message-action open-target-main"
                disabled={!workspacePath}
                type="button"
                onClick={openWorkspaceWithDefaultTarget}
              >
                {renderOpenTargetIcon(selectedOpenTarget)}
              </button>
            </Tooltip>
            <PopoverMenu
              align="end"
              className="popover-open-targets"
              open={openTargetMenuOpen}
              sideOffset={4}
              trigger={
                <button
                  aria-label="切换默认打开目标"
                  className="message-action open-target-trigger"
                  disabled={!workspacePath}
                  type="button"
                >
                  <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </button>
              }
              onOpenChange={setOpenTargetMenuOpen}
            >
              {openTargets.map((target) => (
                <PopoverItem
                  icon={renderOpenTargetIcon(target)}
                  key={target.id}
                  selected={target.id === defaultOpenTargetId}
                  withCheck
                  onClick={() => selectOpenTarget(target.id)}
                >
                  {target.label}
                </PopoverItem>
              ))}
            </PopoverMenu>
          </div>
          <Tooltip
            content={showPinnedSummary ? "隐藏置顶摘要" : "显示置顶摘要"}
          >
            <button
              aria-label={showPinnedSummary ? "隐藏置顶摘要" : "显示置顶摘要"}
              aria-pressed={showPinnedSummary}
              className="message-action"
              disabled={!workspacePath}
              type="button"
              onClick={() => setShowPinnedSummary((current) => !current)}
            >
              <Columns2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          </Tooltip>
          <Tooltip
            content={bottomPanelVisible ? "隐藏底部面板" : "显示底部面板"}
          >
            <button
              aria-label={bottomPanelVisible ? "隐藏底部面板" : "显示底部面板"}
              aria-pressed={bottomPanelVisible}
              className="message-action"
              type="button"
              onClick={() => setBottomPanelVisible((current) => !current)}
            >
              <PanelBottom size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          </Tooltip>
          <Tooltip
            content={rightSidebarVisible ? "隐藏右侧边栏" : "显示右侧边栏"}
          >
            <button
              aria-label={rightSidebarVisible ? "隐藏右侧边栏" : "显示右侧边栏"}
              aria-pressed={rightSidebarVisible}
              className="message-action"
              type="button"
              onClick={() => setRightSidebarVisible((current) => !current)}
            >
              <PanelRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
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
              timelineItems.map((item) => (
                <TimelineItem item={item} key={item.id} />
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
        <div
          className={`chat-composer ${
            showEnvironmentPanel ? "with-environment-panel" : ""
          }`}
        >
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
        <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZE} />
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

function renderOpenTargetIcon(target: DesktopOpenTarget): React.ReactNode {
  if (target.iconDataUrl) {
    return (
      <img
        alt=""
        className="chat-open-target-icon"
        src={target.iconDataUrl}
      />
    );
  }
  if (target.kind === "file-explorer") {
    return <FolderOpen size={APP_ICON_SIZE} />;
  }
  if (target.kind === "terminal") {
    return <SquareTerminal size={APP_ICON_SIZE} />;
  }
  if (target.kind === "editor") {
    return <Code2 size={APP_ICON_SIZE} />;
  }
  return <File size={APP_ICON_SIZE} />;
}

type TimelineToolRun = {
  id: string;
  toolName: string;
  callContent: string;
  resultContent: string;
  isError: boolean;
  isRunning: boolean;
};

type TimelineToolGroup = {
  id: string;
  type: "tool_group";
  runs: TimelineToolRun[];
};

type TimelineItem = DesktopSessionEvent | TimelineToolGroup;

function TimelineItem({ item }: { item: TimelineItem }): React.ReactNode {
  if (item.type === "tool_group") {
    return <TimelineToolGroupView group={item} />;
  }

  const event = item;
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
    return null;
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
          <FileDiff size={APP_ICON_SIZE} />
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

function TimelineToolGroupView({
  group,
}: {
  group: TimelineToolGroup;
}): React.ReactNode {
  const commandCount = group.runs.length;

  return (
    <details className="timeline-command-group" open>
      <summary className="timeline-command-group-summary">
        <SquareTerminal size={APP_ICON_SIZE} />
        <span>
          {commandCount === 1 ? "已运行命令" : `已运行 ${commandCount} 条命令`}
        </span>
        <ChevronDown
          className="timeline-command-group-chevron"
          size={APP_ICON_SIZE}
          strokeWidth={APP_ICON_STROKE_WIDTH}
        />
      </summary>
      <div className="timeline-command-list">
        {group.runs.map((run) => (
          <article
            className={`timeline-command-card ${run.isError ? "error" : ""}`}
            key={run.id}
          >
            <div className="timeline-command-card-header">
              <span>{displayToolName(run.toolName)}</span>
              <small>
                {run.isRunning ? "运行中" : run.isError ? "失败" : "成功"}
              </small>
            </div>
            {run.callContent ? (
              <pre className="timeline-command-input">{formatToolInput(run)}</pre>
            ) : null}
            {run.resultContent ? (
              <pre className="timeline-command-output">{run.resultContent}</pre>
            ) : null}
          </article>
        ))}
      </div>
    </details>
  );
}

function ChatMessage({ message }: { message: Message }): React.ReactNode {
  if (message.role === "user") {
    return (
      <article className="chat-message-row user">
        <div className="user-message-bubble">{message.text}</div>
        <MessageActionButton label="复制" tip="复制" text={message.text}>
          <Copy size={APP_ICON_SIZE} />
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
            <Copy size={APP_ICON_SIZE} />
          </MessageActionButton>
          <Tooltip content="赞">
            <button aria-label="赞" className="message-action" type="button">
              <ThumbsUp size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="踩">
            <button aria-label="踩" className="message-action" type="button">
              <ThumbsDown size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="重新生成">
            <button
              aria-label="重新生成"
              className="message-action"
              type="button"
            >
              <RotateCcw size={APP_ICON_SIZE} />
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
          <Settings size={APP_ICON_SIZE} />
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
          <FileDiff size={APP_ICON_SIZE} />
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
          <Laptop size={APP_ICON_SIZE} />
          <span>本地</span>
          <ChevronRight className="environment-row-chevron" size={APP_ICON_SIZE} />
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCreateBranch}
        >
          <GitBranch size={APP_ICON_SIZE} />
          <span title={gitLabel}>{gitLabel}</span>
          <ChevronRight className="environment-row-chevron" size={APP_ICON_SIZE} />
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCommitOrPush}
        >
          <Upload size={APP_ICON_SIZE} />
          <span>提交或推送</span>
        </button>
        <button
          className="environment-action-row"
          type="button"
          onClick={onCreatePullRequest}
        >
          <GitPullRequest size={APP_ICON_SIZE} />
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

function groupTimelineToolEvents(
  sourceEvents: DesktopSessionEvent[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let pendingToolEvents: DesktopSessionEvent[] = [];

  function flushToolEvents(): void {
    if (pendingToolEvents.length === 0) return;
    const group = buildToolGroup(pendingToolEvents);
    if (group) {
      items.push(group);
    }
    pendingToolEvents = [];
  }

  for (const event of sourceEvents) {
    if (event.type === "tool_call" || event.type === "tool_result") {
      pendingToolEvents.push(event);
      continue;
    }
    flushToolEvents();
    items.push(event);
  }

  flushToolEvents();
  return items;
}

function buildToolGroup(events: DesktopSessionEvent[]): TimelineToolGroup | null {
  const runs: TimelineToolRun[] = [];

  for (const event of events) {
    const toolName = stringMetadata(event, "toolName") ?? "Tool";
    const content = normalizedToolContent(event, toolName);

    if (event.type === "tool_call") {
      runs.push({
        id: event.id,
        toolName,
        callContent: content,
        resultContent: "",
        isError: false,
        isRunning: true,
      });
      continue;
    }

    const pendingRun =
      findPendingToolRun(runs, toolName) ?? findPendingToolRun(runs);
    if (pendingRun) {
      pendingRun.resultContent = content;
      pendingRun.isError = event.metadata?.isError === true;
      pendingRun.isRunning = false;
      continue;
    }

    if (!content && event.metadata?.isError !== true) {
      continue;
    }
    runs.push({
      id: event.id,
      toolName,
      callContent: "",
      resultContent: content,
      isError: event.metadata?.isError === true,
      isRunning: false,
    });
  }

  const visibleRuns = runs.filter(
    (run) =>
      run.callContent ||
      run.resultContent ||
      run.isError ||
      run.isRunning,
  );

  if (visibleRuns.length === 0) return null;

  return {
    id: `tool-group-${events[0]?.id ?? "empty"}`,
    type: "tool_group",
    runs: visibleRuns,
  };
}

function findPendingToolRun(
  runs: TimelineToolRun[],
  toolName?: string,
): TimelineToolRun | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run || !run.isRunning) continue;
    if (toolName && run.toolName !== toolName) continue;
    return run;
  }
  return null;
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

function displayToolName(toolName: string): string {
  return toolName === "Bash" ? "Shell" : toolName;
}

function normalizedToolContent(
  event: DesktopSessionEvent,
  toolName: string,
): string {
  const content = event.content?.trim() ?? "";
  if (!content) return "";
  if (event.type === "tool_result" && content === toolName) return "";
  const prefix = `${toolName}:`;
  return content.startsWith(prefix) ? content.slice(prefix.length).trim() : content;
}

function formatToolInput(run: TimelineToolRun): string {
  if (displayToolName(run.toolName) === "Shell") {
    return `$ ${run.callContent}`;
  }
  return run.callContent;
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
      <Sparkles size={APP_ICON_SIZE} />
      <span>已处理 {formatDuration(seconds)}</span>
      <ChevronRight size={APP_ICON_SIZE} />
    </button>
  );
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
