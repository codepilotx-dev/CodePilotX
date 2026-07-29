import React from "react";
import {
  REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH,
  REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP,
  REVIEW_FILE_TREE_PANEL_MAX_WIDTH,
  REVIEW_FILE_TREE_PANEL_MIN_WIDTH,
  clampReviewFileTreePanelWidth,
} from "../diff/WorkspaceReviewDiff.js";

type ReviewFileTreeResizeControllerProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  panelRef: React.RefObject<HTMLElement | null>;
  width: number;
  onSetWidth: (width: number) => void;
};

type ResizeSession = {
  containerLeft: number;
  containerWidth: number | undefined;
  lastWidth: number;
  pointerId: number;
  startWidth: number;
  startX: number;
};

export function ReviewFileTreeResizeController({
  containerRef,
  panelRef,
  width,
  onSetWidth,
}: ReviewFileTreeResizeControllerProps): React.ReactNode {
  const handleRef = React.useRef<HTMLDivElement | null>(null);
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = React.useRef<number | null>(null);
  const settleFrameRef = React.useRef<number | null>(null);
  const settlePaintFrameRef = React.useRef<number | null>(null);
  const sessionRef = React.useRef<ResizeSession | null>(null);
  const onSetWidthRef = React.useRef(onSetWidth);
  onSetWidthRef.current = onSetWidth;

  const clearScheduledFrames = React.useCallback((): void => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (settleFrameRef.current !== null) {
      window.cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
    if (settlePaintFrameRef.current !== null) {
      window.cancelAnimationFrame(settlePaintFrameRef.current);
      settlePaintFrameRef.current = null;
    }
  }, []);

  const setSkeletonActive = React.useCallback(
    (active: boolean): void => {
      panelRef.current?.toggleAttribute(
        "data-resize-skeleton-active",
        active,
      );
    },
    [panelRef],
  );

  const finishResize = React.useCallback(
    (commit: boolean): void => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      clearScheduledFrames();

      const handle = handleRef.current;
      const preview = previewRef.current;
      if (preview) {
        preview.hidden = true;
        preview.style.removeProperty("transform");
      }
      if (handle?.hasPointerCapture(session.pointerId)) {
        handle.releasePointerCapture(session.pointerId);
      }

      if (!commit) {
        if (handle) delete handle.dataset.resizePhase;
        setSkeletonActive(false);
        return;
      }

      if (handle) handle.dataset.resizePhase = "settling";
      onSetWidthRef.current(session.lastWidth);
      settleFrameRef.current = window.requestAnimationFrame(() => {
        settleFrameRef.current = null;
        settlePaintFrameRef.current = window.requestAnimationFrame(() => {
          settlePaintFrameRef.current = null;
          if (handle) delete handle.dataset.resizePhase;
          setSkeletonActive(false);
        });
      });
    },
    [clearScheduledFrames, setSkeletonActive],
  );

  React.useEffect(() => {
    const handleWindowBlur = (): void => finishResize(false);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      finishResize(false);
      clearScheduledFrames();
      setSkeletonActive(false);
    };
  }, [clearScheduledFrames, finishResize, setSkeletonActive]);

  const setClampedWidth = React.useCallback(
    (nextWidth: number): void => {
      const containerWidth =
        containerRef.current?.getBoundingClientRect().width;
      onSetWidthRef.current(
        clampReviewFileTreePanelWidth(nextWidth, containerWidth),
      );
    },
    [containerRef],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "Home") {
        event.preventDefault();
        setClampedWidth(REVIEW_FILE_TREE_PANEL_MIN_WIDTH);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setClampedWidth(REVIEW_FILE_TREE_PANEL_MAX_WIDTH);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.shiftKey
        ? REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP * 3
        : REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP;
      setClampedWidth(
        width + (event.key === "ArrowLeft" ? step : -step),
      );
    },
    [setClampedWidth, width],
  );

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();

      finishResize(false);
      clearScheduledFrames();
      setSkeletonActive(false);

      const containerRect = containerRef.current?.getBoundingClientRect();
      const handle = event.currentTarget;
      const preview = previewRef.current;
      sessionRef.current = {
        containerLeft: containerRect?.left ?? 0,
        containerWidth: containerRect?.width,
        lastWidth: width,
        pointerId: event.pointerId,
        startWidth: width,
        startX: event.clientX,
      };
      handle.setPointerCapture(event.pointerId);
      handle.dataset.resizePhase = "dragging";
      if (preview) {
        preview.hidden = false;
        preview.style.transform = `translate3d(${
          event.clientX - (containerRect?.left ?? 0)
        }px, 0, 0)`;
      }
      setSkeletonActive(true);
    },
    [
      clearScheduledFrames,
      containerRef,
      finishResize,
      setSkeletonActive,
      width,
    ],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();

      session.lastWidth = clampReviewFileTreePanelWidth(
        session.startWidth + session.startX - event.clientX,
        session.containerWidth,
      );
      const previewLeft = event.clientX - session.containerLeft;
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (previewRef.current) {
          previewRef.current.style.transform = `translate3d(${previewLeft}px, 0, 0)`;
        }
      });
    },
    [],
  );

  return (
    <>
      <div
        aria-label="调整审查文件导航宽度"
        aria-orientation="vertical"
        aria-valuemax={REVIEW_FILE_TREE_PANEL_MAX_WIDTH}
        aria-valuemin={REVIEW_FILE_TREE_PANEL_MIN_WIDTH}
        aria-valuenow={width}
        className="review-file-tree-resize-handle"
        data-resize-handle="true"
        ref={handleRef}
        role="separator"
        tabIndex={0}
        title="拖拽调整文件导航宽度，双击恢复默认宽度"
        onDoubleClick={() =>
          setClampedWidth(REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH)
        }
        onKeyDown={handleKeyDown}
        onLostPointerCapture={() => finishResize(false)}
        onPointerCancel={() => finishResize(false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => finishResize(true)}
      />
      <div
        className="review-file-tree-resize-preview"
        hidden
        ref={previewRef}
      />
    </>
  );
}
