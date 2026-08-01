import React from "react";
import { LoaderCircle } from "lucide-react";
import type { RpcResult } from "@codepilotx/agent-protocol";
import type {
  DesktopDiffMarkerStyle,
} from "../../../../shared/types.js";

import { Button } from "../../../components/ui/Button.js";

export type ThreadPatchDiff = RpcResult<"thread/patch/diff">;

const LazyFileMutationDiffContent = React.lazy(async () => {
  const module = await import("./FileMutationDiffContent.js");
  return { default: module.FileMutationDiffContent };
});

export function FileMutationDiffBody({
  diff,
  diffMarkerStyle,
}: {
  diff: ThreadPatchDiff;
  diffMarkerStyle: DesktopDiffMarkerStyle;
}): React.ReactNode {
  return (
    <React.Suspense fallback={<FileMutationDiffLoading />}>
      <LazyFileMutationDiffContent
        diff={diff}
        diffMarkerStyle={diffMarkerStyle}
      />
    </React.Suspense>
  );
}

export function FileMutationDiffLoading(): React.ReactNode {
  return (
    <div className="canonical-file-mutation__message" role="status">
      <LoaderCircle className="canonical-spin" aria-hidden="true" />
      正在加载差异
    </div>
  );
}

export function FileMutationDiffError({
  onRetry,
}: {
  onRetry: () => void;
}): React.ReactNode {
  return (
    <div className="canonical-file-mutation__message" role="alert">
      <span>无法加载本次文件差异</span>
      <Button onClick={onRetry}>重试</Button>
    </div>
  );
}
