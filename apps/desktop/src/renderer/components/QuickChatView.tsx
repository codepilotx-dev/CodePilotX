import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns2,
  Code2,
  Copy,
  Maximize2,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { useQuickChatContext } from "../context/QuickChatContext.js";
import type { Message, ToolLogEntry } from "../uiTypes.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { Tooltip } from "./ui/Tooltip.js";

type ToolRun = {
  id: string;
  toolUseId?: string;
  toolName: string;
  summary: string;
  status: "running" | "success" | "error";
  input?: unknown;
  content?: unknown;
  createdAtIso: string;
};

type TimelineItem =
  | { type: "message"; id: string; createdAtIso: string; message: Message }
  | { type: "tool"; id: string; createdAtIso: string; tool: ToolRun };

export function QuickChatView(): React.ReactNode {
  const {
    isConversationRoute,
    isConversationLoading,
    sessionTitle,
    messages,
    toolLog,
    streamState,
    errorMessage,
    onDismissError,
    sessionStatus,
    composer,
  } = useQuickChatContext();

  const conversationMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const toolRuns = React.useMemo(() => buildToolRuns(toolLog), [toolLog]);
  const timeline = React.useMemo(
    () => buildTimeline(conversationMessages, toolRuns),
    [conversationMessages, toolRuns],
  );
  const hasMessages = timeline.length > 0;
  const hasStreamingAssistantText = conversationMessages.some(
    (message) =>
      message.role === "assistant" &&
      message.streaming &&
      Boolean(message.text.trim()),
  );
  const showThinking =
    (sessionStatus === "running" || sessionStatus === "waiting") &&
    !hasStreamingAssistantText;
  const showThinkingDetails =
    showThinking &&
    (streamState.mode === "thinking" ||
      streamState.thinkingRedacted);

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
                : sessionTitle ?? getConversationTitle(conversationMessages)}
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

        <div className="quick-chat-content">
          {errorMessage ? (
            <div className="error-banner">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
              <button onClick={onDismissError} type="button">
                关闭
              </button>
            </div>
          ) : null}
          <div className="conversation-stream">
            {isConversationLoading ? (
              <div className="assistant-thinking">加载对话中</div>
            ) : (
              timeline.map((item) =>
                item.type === "message" ? (
                  <ChatMessage message={item.message} key={item.id} />
                ) : (
                  <ToolRunCard tool={item.tool} key={item.id} />
                ),
              )
            )}
            {!isConversationLoading && showThinkingDetails ? (
              <ThinkingPill
                text={
                  streamState.mode === "thinking" ? streamState.thinkingText : ""
                }
                redacted={streamState.thinkingRedacted === true}
              />
            ) : !isConversationLoading && showThinking ? (
              <ThinkingPill text="" />
            ) : null}
          </div>
        </div>

        {composer ? <div className="chat-composer">{composer}</div> : null}
      </section>
    );
  }

  return (
    <section className="quick-chat-view">
      <div className="quick-chat-hero">
        <h1>
          我们应该在 <span className="project-name">ClaudeCode</span>{" "}
          中构建什么?
        </h1>
      </div>

      {errorMessage ? (
        <div className="quick-chat-content">
          <div className="error-banner">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
            <button onClick={onDismissError} type="button">
              关闭
            </button>
          </div>
        </div>
      ) : null}
      {composer ? <div className="chat-composer">{composer}</div> : null}
    </section>
  );
}

function ToolRunCard({ tool }: { tool: ToolRun }): React.ReactNode {
  const isError = tool.status === "error";
  const isRunning = tool.status === "running";
  const [open, setOpen] = React.useState(isError);
  React.useEffect(() => {
    if (isError) setOpen(true);
  }, [isError]);
  const detailText = React.useMemo(
    () => (open ? formatToolDetail(tool) : ""),
    [open, tool],
  );
  return (
    <article
      className={`tool-run-card ${isError ? "error" : ""} ${
        isRunning ? "running" : ""
      }`}
    >
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className="tool-run-title">
            <TerminalSquare size={14} />
            {isRunning ? "正在运行" : "已运行命令"}
          </span>
          <span className="tool-run-name">{tool.toolName}</span>
          <ChevronDown className="tool-run-chevron" size={14} />
        </summary>
        <div className="tool-run-body">
          <div className="tool-run-shell">
            <span>{tool.toolName}</span>
            <pre>{tool.summary}</pre>
          </div>
          {detailText ? <pre className="tool-run-detail">{detailText}</pre> : null}
          <div className={`tool-run-status ${isError ? "error" : ""}`}>
            {isError ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
            <span>{isError ? "失败" : isRunning ? "运行中" : "成功"}</span>
          </div>
        </div>
      </details>
    </article>
  );
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

function getConversationTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage?.text.trim().split(/\r?\n/)[0] ?? "新对话";
  return title.length > 28 ? `${title.slice(0, 28)}...` : title;
}

function ThinkingPill({
  redacted = false,
  text,
}: {
  redacted?: boolean;
  text: string;
}): React.ReactNode {
  const [seconds, setSeconds] = React.useState(0);
  const [open, setOpen] = React.useState(false);

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
    <details
      className="chat-thinking-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="chat-thinking-pill">
        <Sparkles size={12} />
        <span>{thinkingSummary(text, redacted, seconds)}</span>
        <ChevronRight size={12} />
      </summary>
      {open && (text.trim() || redacted) ? (
        <pre>{redacted ? "思考内容已隐藏" : text}</pre>
      ) : null}
    </details>
  );
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function buildTimeline(messages: Message[], tools: ToolRun[]): TimelineItem[] {
  return [
    ...messages.map(message => ({
      type: "message" as const,
      id: `message-${message.id}`,
      createdAtIso: message.createdAt,
      message,
    })),
    ...tools.map(tool => ({
      type: "tool" as const,
      id: `tool-${tool.id}`,
      createdAtIso: tool.createdAtIso,
      tool,
    })),
  ].sort((a, b) => timestampValue(a.createdAtIso) - timestampValue(b.createdAtIso));
}

function buildToolRuns(entries: ToolLogEntry[]): ToolRun[] {
  const grouped = new Map<string, ToolRun>();
  const ungrouped: ToolRun[] = [];
  for (const entry of entries) {
    const createdAtIso = normalizeIso(entry.createdAtIso);
    if (!entry.toolUseId) {
      ungrouped.push(toolRunFromEntry(entry, createdAtIso));
      continue;
    }
    const current = grouped.get(entry.toolUseId);
    if (!current) {
      grouped.set(entry.toolUseId, toolRunFromEntry(entry, createdAtIso));
      continue;
    }
    grouped.set(entry.toolUseId, mergeToolRun(current, entry, createdAtIso));
  }
  return [...grouped.values(), ...ungrouped].sort(
    (a, b) => timestampValue(a.createdAtIso) - timestampValue(b.createdAtIso),
  );
}

function toolRunFromEntry(entry: ToolLogEntry, createdAtIso: string): ToolRun {
  return {
    id: entry.toolUseId ?? entry.id,
    toolUseId: entry.toolUseId,
    toolName: entry.toolName,
    summary: entry.summary,
    status:
      entry.status ??
      (entry.isError ? "error" : entry.kind === "result" ? "success" : "running"),
    input: entry.input,
    content: entry.content,
    createdAtIso,
  };
}

function mergeToolRun(
  current: ToolRun,
  entry: ToolLogEntry,
  createdAtIso: string,
): ToolRun {
  const entryStatus =
    entry.status ??
    (entry.isError ? "error" : entry.kind === "result" ? "success" : "running");
  return {
    ...current,
    toolName: entry.toolName || current.toolName,
    summary: entry.kind === "start" ? entry.summary : current.summary,
    status: entry.kind === "result" ? entryStatus : current.status,
    input: entry.kind === "start" ? entry.input ?? current.input : current.input,
    content: entry.kind === "result" ? entry.content ?? entry.summary : current.content,
    createdAtIso:
      timestampValue(createdAtIso) < timestampValue(current.createdAtIso)
        ? createdAtIso
        : current.createdAtIso,
  };
}

function formatToolDetail(tool: ToolRun): string {
  const parts: string[] = [];
  if (tool.input !== undefined) {
    parts.push(`Input\n${formatUnknown(tool.input)}`);
  }
  if (tool.content !== undefined) {
    parts.push(`Output\n${formatUnknown(tool.content)}`);
  }
  return parts.join("\n\n");
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeIso(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function timestampValue(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function thinkingSummary(
  text: string,
  redacted: boolean,
  seconds: number,
): string {
  if (redacted) return "思考内容已隐藏";
  const trimmed = text.slice(0, 512).trim().replace(/\s+/g, " ");
  if (!trimmed) return `已处理 ${formatDuration(seconds)}`;
  return trimmed.length > 54 ? `${trimmed.slice(0, 54)}...` : trimmed;
}
