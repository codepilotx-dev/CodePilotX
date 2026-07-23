import React from "react";
import { ChevronDown } from "lucide-react";

import {
  MarkdownMessage,
  type MarkdownMessageProps,
} from "../MarkdownMessage.js";
import { ConversationMarkdownErrorBoundary } from "./ConversationTurnErrorBoundary.js";

const DEFAULT_COLLAPSED_LINE_COUNT = 20;
const FALLBACK_FONT_SIZE_PX = 13;
const FALLBACK_LINE_HEIGHT_RATIO = 1.5;
const HEIGHT_EPSILON_PX = 1;
const FOCUSABLE_DESCENDANT_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "audio[controls]",
  "video[controls]",
  "iframe",
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

type CollapseState = "uncollapsible" | "collapsed" | "expanded";

type TextMeasurement = {
  collapsedHeightPx: number;
  contentHeightPx: number;
};

export type CollapsibleUserMarkdownProps = {
  text: string;
  cwd?: string | null;
  collapsedLineCount?: number;
  canCopyFileReferenceContents?: MarkdownMessageProps[
    "canCopyFileReferenceContents"
  ];
  onCopyFileReferenceContents?: MarkdownMessageProps[
    "onCopyFileReferenceContents"
  ];
  onOpenFileReference?: MarkdownMessageProps["onOpenFileReference"];
};

export function CollapsibleUserMarkdown({
  text,
  cwd = null,
  collapsedLineCount = DEFAULT_COLLAPSED_LINE_COUNT,
  canCopyFileReferenceContents,
  onCopyFileReferenceContents,
  onOpenFileReference,
}: CollapsibleUserMarkdownProps): React.ReactNode {
  const [measurementElement, setMeasurementElement] =
    React.useState<HTMLDivElement | null>(null);
  const [measurement, setMeasurement] = React.useState<TextMeasurement | null>(null);
  const [expandedText, setExpandedText] = React.useState<string | null>(null);
  const clippedViewportRef = React.useRef<HTMLDivElement | null>(null);
  const contentId = React.useId();

  React.useLayoutEffect(() => {
    if (!measurementElement) return;

    const updateMeasurement = (): void => {
      const next = measureTextContent(
        measurementElement,
        collapsedLineCount,
        FALLBACK_FONT_SIZE_PX,
      );
      setMeasurement((current) =>
        current?.collapsedHeightPx === next.collapsedHeightPx &&
        current.contentHeightPx === next.contentHeightPx
          ? current
          : next,
      );
    };

    updateMeasurement();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateMeasurement);
    observer.observe(measurementElement);
    return () => observer.disconnect();
  }, [collapsedLineCount, measurementElement, text]);

  const collapseState = resolveCollapseState(measurement, text, expandedText);
  const collapsed = collapseState === "collapsed";
  const showsEllipsis = collapsed && collapsedLineCount > 2;
  const visibleLineCount = collapsedLineCount - (showsEllipsis ? 1 : 0);

  React.useEffect(() => {
    if (!collapsed) return;
    const viewport = clippedViewportRef.current;
    if (!viewport) return;
    return hideClippedFocusableDescendants(viewport);
  }, [collapsed, collapsedLineCount, text]);

  return (
    <div className="user-message-markdown">
      <div className="user-message-markdown__body">
        <div
          className={
            collapsed
              ? "user-message-markdown__viewport is-collapsed"
              : "user-message-markdown__viewport"
          }
          id={contentId}
          ref={clippedViewportRef}
          style={collapsed ? { maxHeight: `${visibleLineCount}lh` } : undefined}
        >
          <div
            className="user-message-markdown__measurement"
            ref={setMeasurementElement}
          >
            <ConversationMarkdownErrorBoundary contentKey={text}>
              <MarkdownMessage
                canCopyFileReferenceContents={canCopyFileReferenceContents}
                cwd={cwd}
                onCopyFileReferenceContents={onCopyFileReferenceContents}
                onOpenFileReference={onOpenFileReference}
                text={text}
              />
            </ConversationMarkdownErrorBoundary>
          </div>
        </div>
        {showsEllipsis ? (
          <span aria-hidden="true" className="user-message-markdown__ellipsis">
            …
          </span>
        ) : null}
      </div>
      {collapseState === "uncollapsible" ? null : (
        <button
          aria-controls={contentId}
          aria-expanded={collapseState === "expanded"}
          className="user-message-markdown__toggle"
          onClick={() => {
            setExpandedText((current) => (current === text ? null : text));
          }}
          type="button"
        >
          <span>{collapseState === "expanded" ? "收起" : "显示更多"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function resolveCollapseState(
  measurement: TextMeasurement | null,
  text: string,
  expandedText: string | null,
): CollapseState {
  if (
    measurement === null ||
    measurement.contentHeightPx <=
      measurement.collapsedHeightPx + HEIGHT_EPSILON_PX
  ) {
    return "uncollapsible";
  }
  return expandedText === text ? "expanded" : "collapsed";
}

function measureTextContent(
  element: HTMLElement,
  collapsedLineCount: number,
  fallbackFontSizePx: number,
): TextMeasurement {
  const computedStyle = window.getComputedStyle(element);
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
  const fontSizePx = Number.isFinite(parsedFontSize)
    ? parsedFontSize
    : fallbackFontSizePx;
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const lineHeightPx = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : fontSizePx * FALLBACK_LINE_HEIGHT_RATIO;
  return {
    collapsedHeightPx: Math.ceil(lineHeightPx * collapsedLineCount),
    contentHeightPx: Math.ceil(element.scrollHeight),
  };
}

function hideClippedFocusableDescendants(viewport: HTMLElement): () => void {
  const trackedElements = new Map<HTMLElement, string | null>();
  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const element = entry.target as HTMLElement;
              if (!trackedElements.has(element)) continue;
              setFocusableElementVisibility(
                element,
                entry.isIntersecting && entry.intersectionRatio >= 1,
                trackedElements.get(element) ?? null,
              );
            }
          },
          { root: viewport, rootMargin: "0px", threshold: 1 },
        );

  const scan = (): void => {
    for (const element of trackedElements.keys()) {
      if (viewport.contains(element)) continue;
      intersectionObserver?.unobserve(element);
      trackedElements.delete(element);
    }

    for (const element of viewport.querySelectorAll<HTMLElement>(
      FOCUSABLE_DESCENDANT_SELECTOR,
    )) {
      if (trackedElements.has(element) || element.hasAttribute("inert")) {
        continue;
      }
      const previousAriaHidden = element.getAttribute("aria-hidden");
      trackedElements.set(element, previousAriaHidden);
      setFocusableElementVisibility(
        element,
        intersectionObserver === null && isElementFullyVisible(element, viewport),
        previousAriaHidden,
      );
      intersectionObserver?.observe(element);
    }
  };

  scan();
  const mutationObserver = new MutationObserver(scan);
  mutationObserver.observe(viewport, { childList: true, subtree: true });

  return () => {
    intersectionObserver?.disconnect();
    mutationObserver.disconnect();
    for (const [element, previousAriaHidden] of trackedElements) {
      setFocusableElementVisibility(element, true, previousAriaHidden);
    }
  };
}

export function setFocusableElementVisibility(
  element: Pick<
    HTMLElement,
    "toggleAttribute" | "setAttribute" | "removeAttribute"
  >,
  visible: boolean,
  previousAriaHidden: string | null,
): void {
  element.toggleAttribute("inert", !visible);
  if (!visible) {
    element.setAttribute("aria-hidden", "true");
    return;
  }
  if (previousAriaHidden === null) {
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", previousAriaHidden);
  }
}

function isElementFullyVisible(element: Element, viewport: Element): boolean {
  const elementRect = element.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  return (
    elementRect.top >= viewportRect.top &&
    elementRect.right <= viewportRect.right &&
    elementRect.bottom <= viewportRect.bottom &&
    elementRect.left >= viewportRect.left
  );
}
