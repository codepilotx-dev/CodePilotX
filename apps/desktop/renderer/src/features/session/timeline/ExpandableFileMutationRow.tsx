import React from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
} from "lucide-react";
import type { Item } from "@codepilotx/shared/thread";
import type { RpcParams, RpcResult } from "@codepilotx/agent-protocol";
import type { DesktopDiffMarkerStyle } from "../../../../shared/types.js";

import type {
  CanonicalItemDisclosure,
  FileChangeDisplay,
  ReadThreadPatchDiff,
} from "./CanonicalItemRenderer.js";
import { fileMutationLabel } from "./CanonicalItemRenderer.js";
import {
  FileMutationDiffBody,
  FileMutationDiffError,
  FileMutationDiffLoading,
} from "./FileMutationDiffBody.js";

type ToolItem = Extract<Item, { type: "tool" }>;
type Diff = RpcResult<"thread/patch/diff">;
type DiffLoadState =
  | { status: "loading" | "error" }
  | { status: "loaded"; diff: Diff };

export type ThreadPatchDiffLoader = {
  invalidate: (key: string) => void;
  request: (
    key: string,
    params: RpcParams<"thread/patch/diff">,
    publish: (state: DiffLoadState) => void,
  ) => () => void;
};

export function createThreadPatchDiffLoader(
  readThreadPatchDiff: ReadThreadPatchDiff,
): ThreadPatchDiffLoader {
  const cache = new Map<string, Diff>();
  return {
    invalidate: (key) => cache.delete(key),
    request: (key, params, publish) => {
      const cached = cache.get(key);
      if (cached) {
        publish({ status: "loaded", diff: cached });
        return () => undefined;
      }
      let active = true;
      publish({ status: "loading" });
      void readThreadPatchDiff(params).then(
        (diff) => {
          if (!active) return;
          cache.set(key, diff);
          publish({ status: "loaded", diff });
        },
        () => {
          if (active) publish({ status: "error" });
        },
      );
      return () => {
        active = false;
      };
    },
  };
}

export function ExpandableFileMutationRow({
  diffMarkerStyle,
  disclosure,
  file,
  item,
  readThreadPatchDiff,
  threadId,
}: {
  diffMarkerStyle: DesktopDiffMarkerStyle;
  disclosure: CanonicalItemDisclosure;
  file: FileChangeDisplay;
  item: ToolItem;
  readThreadPatchDiff: ReadThreadPatchDiff;
  threadId: string;
}): React.ReactNode {
  const [attempt, setAttempt] = React.useState(0);
  const [loadState, setLoadState] = React.useState<DiffLoadState>({
    status: "loading",
  });
  const loader = React.useMemo(
    () => createThreadPatchDiffLoader(readThreadPatchDiff),
    [readThreadPatchDiff],
  );
  const requestKey = `${threadId}:${item.callID}:${file.path}`;

  React.useEffect(() => {
    if (!disclosure.expanded) return;
    return loader.request(
      requestKey,
      { threadId, toolCallId: item.callID, path: file.path },
      setLoadState,
    );
  }, [attempt, disclosure.expanded, file.path, item.callID, loader, requestKey, threadId]);

  return (
    <details
      className="canonical-file-mutation__item"
      data-expandable="true"
      onToggle={(event) => {
        disclosure.onExpandedChange(disclosure.id, event.currentTarget.open);
      }}
      open={disclosure.expanded}
    >
      <summary>
        <Pencil aria-hidden="true" />
        <span title={file.path}>{fileMutationLabel(item.state, file.path)}</span>
        <span className="canonical-file-mutation__stats">
          {file.additions !== null ? (
            <small className="canonical-diff-add">+{file.additions}</small>
          ) : null}
          {file.deletions !== null ? (
            <small className="canonical-diff-remove">-{file.deletions}</small>
          ) : null}
        </span>
        {disclosure.expanded ? (
          <ChevronDown className="canonical-file-mutation__chevron" aria-hidden="true" />
        ) : (
          <ChevronRight className="canonical-file-mutation__chevron" aria-hidden="true" />
        )}
      </summary>
      {disclosure.expanded ? (
        <div className="canonical-file-mutation__diff">
          {loadState.status === "loaded" ? (
            <FileMutationDiffBody diff={loadState.diff} diffMarkerStyle={diffMarkerStyle} />
          ) : loadState.status === "error" ? (
            <FileMutationDiffError
              onRetry={() => {
                loader.invalidate(requestKey);
                setAttempt((value) => value + 1);
              }}
            />
          ) : (
            <FileMutationDiffLoading />
          )}
        </div>
      ) : null}
    </details>
  );
}
