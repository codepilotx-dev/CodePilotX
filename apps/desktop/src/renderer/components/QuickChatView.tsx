import React from "react";
import {
  ChevronRight,
  Columns2,
  Code2,
  Copy,
  FileDiff,
  GitBranch,
  GitPullRequest,
  Laptop,
  Maximize2,
  MoreHorizontal,
  RotateCcw,
  Settings,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Upload,
} from "lucide-react";
import { useQuickChatContext } from "../context/QuickChatContext.js";
import type { Message } from "../uiTypes.js";
import type { DesktopSessionEvent } from "../../shared/types.js";
import { legacyMessagesToSessionEvents } from "../../shared/sessionEventModel.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { Tooltip } from "./ui/Tooltip.js";

export function QuickChatView(): React.ReactNode {
  const {
    isConversationRoute,
    isConversationLoading,
    sessionTitle,
    events,
    messages,
    sessionStatus,
    workspaceName,
    workspacePath,
    branchName,
    diff,
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
  const hasMessages = timelineEvents.length > 0;
  const showThinking =
    (sessionStatus === "running" || sessionStatus === "waiting") &&
    !timelineEvents.some(
      (event) =>
        (event.type === "message" || event.type === "assistant_delta") &&
        event.role === "assistant" &&
        Boolean(event.content?.trim()),
    );
  const showEnvironmentPanel = false;

  if (hasMessages || isConversationRoute) {
    return (
      <section
        className={`quick-chat-view active ${
          isConversationRoute ? "conversation-route" : ""
        }`}
      >
        <header className="chat-session-header">
          <div className="chat-session-title">
            <span>
              {isConversationLoading
                ? "加载对话中"
                : sessionTitle ?? getConversationTitle(timelineEvents)}
            </span>
            <Tooltip content="更多操作">
              <button
                aria-label="更多会话操作"
                className="message-action"
                type="button"
              >
                <MoreHorizontal size={16} />
              </button>
            </Tooltip>
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
              <button
                aria-label="分屏"
                className="message-action"
                type="button"
              >
                <Columns2 size={15} strokeWidth={1.8} />
              </button>
            </Tooltip>
            <Tooltip content="展开">
              <button
                aria-label="展开"
                className="message-action"
                type="button"
              >
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
              workspacePath={workspacePath}
            />
          ) : null}
        </div>

        {composer ? <div className="chat-composer">{composer}</div> : null}
      </section>
    );
  }

  return (
    <section className="quick-chat-view">
      <div className="quick-chat-hero">
        {workspaceName ? (
          <h1>
            我们应该在 <span className="project-name">{workspaceName}</span>{" "}
            中构建什么？
          </h1>
        ) : (
          <h1>我们该做什么？</h1>
        )}
      </div>

      {composer ? <div className="chat-composer">{composer}</div> : null}
    </section>
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

function getConversationTitle(events: DesktopSessionEvent[]): string {
  const firstUserMessage = events.find((event) => event.role === "user");
  const title = firstUserMessage?.content?.trim().split(/\r?\n/)[0] ?? "新对话";
  return title.length > 28 ? `${title.slice(0, 28)}...` : title;
}

function EnvironmentPanel({
  branchName,
  diff,
  workspacePath,
}: {
  branchName: string | null
  diff: string
  workspacePath: string | null
}): React.ReactNode {
  const diffSummary = summarizeDiff(diff);
  const gitLabel = branchName?.trim() || "未检测到 Git 分支";

  return (
    <aside className="environment-panel" aria-label="环境信息">
      <div className="environment-panel-header">
        <span>环境信息</span>
        <button aria-label="环境设置" className="message-action" type="button">
          <Settings size={16} />
        </button>
      </div>

      <div className="environment-action-list">
        <button className="environment-action-row" type="button">
          <FileDiff size={16} />
          <span>变更</span>
          <span className="environment-diff-counts">
            <strong>+{formatPanelNumber(diffSummary.additions)}</strong>
            <em>-{formatPanelNumber(diffSummary.deletions)}</em>
          </span>
        </button>
        <button className="environment-action-row" type="button">
          <Laptop size={16} />
          <span>本地</span>
          <ChevronRight className="environment-row-chevron" size={13} />
        </button>
        <button className="environment-action-row" type="button">
          <GitBranch size={16} />
          <span title={gitLabel}>{gitLabel}</span>
          <ChevronRight className="environment-row-chevron" size={13} />
        </button>
        <button className="environment-action-row" type="button">
          <Upload size={16} />
          <span>提交或推送</span>
        </button>
        <button className="environment-action-row" type="button">
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
