import type React from "react";
import { useQuickChatContext } from "../context/QuickChatContext.js";

export function QuickChatView(): React.ReactNode {
  const { workspaceName, composer } = useQuickChatContext();

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
