import React from "react";
import {
  ChevronRight,
  Columns2,
  Code2,
  Copy,
  Maximize2,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useQuickChatContext } from "../context/QuickChatContext.js";
import type { Message } from "../uiTypes.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { Tooltip, TooltipProvider } from "./ui/Tooltip.js";

export function QuickChatView(): React.ReactNode {
  const {
    isConversationRoute,
    isConversationLoading,
    sessionTitle,
    messages,
    sessionStatus,
    composer,
  } = useQuickChatContext();

  const conversationMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const hasMessages = conversationMessages.length > 0;
  const showThinking =
    (sessionStatus === "running" || sessionStatus === "waiting") &&
    !conversationMessages.some(
      (message) =>
        message.role === "assistant" &&
        message.streaming &&
        Boolean(message.text.trim()),
    );

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
          <div className="conversation-stream">
            {isConversationLoading ? (
              <div className="assistant-thinking">加载对话中</div>
            ) : (
              conversationMessages.map((message) => (
                <ChatMessage message={message} key={message.id} />
              ))
            )}
            {!isConversationLoading && showThinking ? <ThinkingPill /> : null}
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

      {composer ? <div className="chat-composer">{composer}</div> : null}
    </section>
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
