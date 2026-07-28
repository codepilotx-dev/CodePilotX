import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanonicalThreadState } from "@codepilotx/session-view";

import {
  CanonicalProcessGroup,
} from "../src/features/session/timeline/CanonicalThreadView.js";
import {
  isCurrentCanonicalThreadRequest,
  selectVisibleCanonicalState,
} from "../src/features/session/timeline/useCanonicalThreadConversation.js";

describe("canonical thread switch", () => {
  test("does not expose state from the previous thread", () => {
    const state = {
      thread: { id: "thread-a" },
    } as unknown as CanonicalThreadState;

    expect(selectVisibleCanonicalState(state, "thread-a")).toBe(state);
    expect(selectVisibleCanonicalState(state, "thread-b")).toBeNull();
    expect(selectVisibleCanonicalState(state, null)).toBeNull();
  });

  test("rejects history and live results from an older thread generation", () => {
    expect(isCurrentCanonicalThreadRequest("thread-b", 2, "thread-b", 2)).toBe(true);
    expect(isCurrentCanonicalThreadRequest("thread-b", 2, "thread-a", 1)).toBe(false);
    expect(isCurrentCanonicalThreadRequest("thread-a", 2, "thread-a", 1)).toBe(false);
  });

  test("does not mount completed process children before expansion", () => {
    const completed = renderToStaticMarkup(
      <CanonicalProcessGroup active={false} failed={false} label="执行完成">
        <span data-testid="expensive-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    );
    const active = renderToStaticMarkup(
      <CanonicalProcessGroup active failed={false} label="正在思考">
        <span data-testid="active-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    );
    const failed = renderToStaticMarkup(
      <CanonicalProcessGroup active={false} failed label="执行出错">
        <span data-testid="failed-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    );

    expect(completed).not.toContain("expensive-tool-card");
    expect(active).toContain("active-tool-card");
    expect(failed).toContain("failed-tool-card");
  });
});
