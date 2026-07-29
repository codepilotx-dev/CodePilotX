import React from "react";
import { SkeletonBlock } from "../../../components/ui/Skeleton.js";

export type ReviewResizeSkeletonVariant = "diff" | "file-tree";

const LINE_COUNT_BY_VARIANT: Record<ReviewResizeSkeletonVariant, number> = {
  diff: 14,
  "file-tree": 10,
};

export function ReviewResizeSkeleton({
  variant,
}: {
  variant: ReviewResizeSkeletonVariant;
}): React.ReactNode {
  return (
    <div
      aria-hidden="true"
      className={`review-resize-skeleton review-resize-skeleton--${variant}`}
      data-resize-skeleton-overlay="true"
    >
      {Array.from({ length: LINE_COUNT_BY_VARIANT[variant] }, (_, index) => (
        <SkeletonBlock
          className={`review-resize-skeleton__line review-resize-skeleton__line--${
            (index % 6) + 1
          }`}
          key={index}
        />
      ))}
    </div>
  );
}
