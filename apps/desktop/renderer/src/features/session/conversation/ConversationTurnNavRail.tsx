import React from "react";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { FileTypeIcon } from "../../layout/FileTypeIcon.js";
import { MarkdownMessage } from "../MarkdownMessage.js";
import { parseMarkdown } from "../../markdown/parser.js";
import type { MarkdownToken } from "../../markdown/types.js";
import type { ConversationTurnNavItem } from "./turnNavigationModel.js";

export type TurnNavigationReason = "activate" | "scrub" | "shortcut";

type Props = {
  items: ConversationTurnNavItem[];
  onNavigate: (
    item: ConversationTurnNavItem,
    reason: TurnNavigationReason,
  ) => void;
  scrollRef: React.RefObject<HTMLElement | null>;
};

export const MIN_TURN_NAV_ITEMS = 4;
export const MIN_TURN_NAV_INLINE_CLEARANCE_PX = 48;
export const TURN_NAV_HOVER_DELAY_MS = 250;
export const TURN_NAV_HANDOFF_WINDOW_MS = 300;

const TURN_NAV_ROW_SELECTOR = "[data-turn-navigation-id]";
const TURN_NAV_BUTTON_SELECTOR = "[data-turn-navigation-item-id]";

type ScrubSession = {
  captureTarget: HTMLButtonElement;
  itemId: string;
  moved: boolean;
  pointerId: number;
};

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function fileName(path: string): string {
  const parts = path.replace(/\\/gu, "/").split("/");
  return parts.at(-1) || path;
}

function collectMarkdownText(
  token: MarkdownToken | Record<string, unknown>,
  output: string[],
): void {
  const candidate = token as Record<string, unknown>;
  if (candidate.type === "space") return;

  if (Array.isArray(candidate.tokens)) {
    for (const child of candidate.tokens) {
      collectMarkdownText(child as Record<string, unknown>, output);
    }
    return;
  }

  if (Array.isArray(candidate.items)) {
    for (const item of candidate.items) {
      collectMarkdownText(item as Record<string, unknown>, output);
    }
    return;
  }

  if (candidate.type === "table") {
    const cells = [
      ...(Array.isArray(candidate.header) ? candidate.header : []),
      ...(Array.isArray(candidate.rows) ? candidate.rows.flat() : []),
    ];
    for (const cell of cells) {
      collectMarkdownText(cell as Record<string, unknown>, output);
    }
    return;
  }

  if (
    typeof candidate.text === "string" &&
    candidate.type !== "html" &&
    candidate.text.trim()
  ) {
    output.push(candidate.text);
  }
}

export function markdownToTurnPreview(text: string): string {
  const source = text.trim();
  if (!source) return "";
  const output: string[] = [];
  for (const token of parseMarkdown(source).tokens) {
    collectMarkdownText(token, output);
  }
  return output.join(" ").replace(/\s+/gu, " ").trim();
}

export function shouldShowTurnNavigation(
  itemCount: number,
  inlineClearance: number,
): boolean {
  return (
    itemCount >= MIN_TURN_NAV_ITEMS &&
    inlineClearance >= MIN_TURN_NAV_INLINE_CLEARANCE_PX
  );
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "[contenteditable]:not([contenteditable='false'])",
        "[role='textbox']",
        "[data-codex-composer]",
        ".chat-composer",
        ".desktop-sidebar",
      ].join(","),
    ),
  );
}

function PreviewCard({
  item,
}: {
  item: ConversationTurnNavItem;
}): React.ReactNode {
  const assistantPreview = React.useMemo(
    () => markdownToTurnPreview(item.assistantText ?? ""),
    [item.assistantText],
  );
  const displayedOutputs = item.outputs.slice(0, 2);

  return (
    <div
      className="conversation-turn-preview-card"
      data-thread-user-message-navigation-tooltip-preview
    >
      <div className="preview-card-user-text">
        {item.userText || "（无内容）"}
      </div>
      {assistantPreview ? (
        <div className="preview-card-assistant-text">
          <MarkdownMessage
            allowWideBlocks={false}
            externalResourcePolicy={{
              allowExternalLinks: false,
              allowRemoteMedia: false,
            }}
            text={item.assistantText ?? ""}
          />
        </div>
      ) : null}
      {displayedOutputs.length > 0 ? (
        <div className="preview-card-outputs">
          {displayedOutputs.map((output) => (
            <span className="preview-card-output" key={`${output.type}:${output.path}`}>
              <FileTypeIcon
                aria-hidden="true"
                className="preview-card-output-icon"
                path={output.path}
                size={18}
              />
              <span className="preview-card-output-label">
                {output.label || fileName(output.path)}
              </span>
            </span>
          ))}
          {item.outputs.length > displayedOutputs.length ? (
            <span className="preview-card-output-more">
              +{item.outputs.length - displayedOutputs.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ConversationTurnNavRail({
  items,
  onNavigate,
  scrollRef,
}: Props): React.ReactNode {
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const hoverTimerRef = React.useRef<number | null>(null);
  const hoveredItemIdRef = React.useRef<string | null>(null);
  const focusedItemIdRef = React.useRef<string | null>(null);
  const pointerInsideRailRef = React.useRef(false);
  const scrubSessionRef = React.useRef<ScrubSession | null>(null);
  const suppressClickRef = React.useRef(false);
  const lastPreviewCloseAtRef = React.useRef(Number.NEGATIVE_INFINITY);
  const [hasInlineClearance, setHasInlineClearance] = React.useState(false);
  const [visibleItemIds, setVisibleItemIds] = React.useState<Set<string>>(
    () => new Set(items.at(-1)?.id ? [items.at(-1)!.id] : []),
  );
  const [previewItemId, setPreviewItemId] = React.useState<string | null>(null);
  const [scrubItemId, setScrubItemId] = React.useState<string | null>(null);
  const itemIdsKey = React.useMemo(
    () => items.map((item) => item.id).join("\0"),
    [items],
  );
  const itemOrder = React.useMemo(
    () => items.map((item) => item.id),
    [itemIdsKey],
  );

  const clearHoverTimer = React.useCallback((): void => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  const closePreview = React.useCallback((): void => {
    clearHoverTimer();
    setPreviewItemId((current) => {
      if (current !== null) lastPreviewCloseAtRef.current = performance.now();
      return null;
    });
  }, [clearHoverTimer]);

  const openPreview = React.useCallback(
    (itemId: string, immediate: boolean): void => {
      clearHoverTimer();
      const isHandoff =
        performance.now() - lastPreviewCloseAtRef.current <=
        TURN_NAV_HANDOFF_WINDOW_MS;
      if (immediate || isHandoff) {
        setPreviewItemId(itemId);
        return;
      }
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        if (hoveredItemIdRef.current === itemId) {
          setPreviewItemId(itemId);
        }
      }, TURN_NAV_HOVER_DELAY_MS);
    },
    [clearHoverTimer],
  );

  React.useEffect(
    () => () => {
      clearHoverTimer();
    },
    [clearHoverTimer],
  );

  React.useLayoutEffect(() => {
    if (items.length < MIN_TURN_NAV_ITEMS) {
      setHasInlineClearance(false);
      return;
    }
    const anchor = anchorRef.current;
    const frame = anchor?.parentElement;
    const content =
      frame?.querySelector<HTMLElement>(".session-timeline-container") ??
      frame?.querySelector<HTMLElement>(".workflow-page__composer-inner");
    if (!frame || !content) return;

    let frameId: number | null = null;
    const updateVisibility = (): void => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const frameRect = frame.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const scale =
          frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
        const inlineClearance =
          (contentRect.left - frameRect.left) / (scale > 0 ? scale : 1);
        setHasInlineClearance(
          shouldShowTurnNavigation(items.length, inlineClearance),
        );
      });
    };

    updateVisibility();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateVisibility);
    observer?.observe(frame);
    observer?.observe(content);
    const styleHost = frame.closest<HTMLElement>(".workflow-page__main");
    const styleObserver =
      typeof MutationObserver === "undefined" || !styleHost
        ? null
        : new MutationObserver(updateVisibility);
    if (styleObserver && styleHost) {
      styleObserver.observe(styleHost, {
        attributeFilter: ["style"],
        attributes: true,
      });
    }
    content.addEventListener("transitionend", updateVisibility);
    window.addEventListener("resize", updateVisibility);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      styleObserver?.disconnect();
      content.removeEventListener("transitionend", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [items.length]);

  React.useEffect(() => {
    const root = scrollRef.current;
    const latestId = items.at(-1)?.id;
    const itemIds = new Set(itemOrder);
    setVisibleItemIds((current) => {
      const retained = new Set([...current].filter((id) => itemIds.has(id)));
      if (retained.size > 0) return retained;
      return new Set(latestId ? [latestId] : []);
    });
    if (!root || items.length < MIN_TURN_NAV_ITEMS) {
      setVisibleItemIds(new Set(latestId ? [latestId] : []));
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setVisibleItemIds(new Set(latestId ? [latestId] : []));
      return;
    }

    const visibleIds = new Set<string>();
    const elementIds = new Map<Element, string>();
    const observedElements = new Set<Element>();

    const publishVisibleIds = (): void => {
      const firstVisibleIndex = itemOrder.findIndex((id) => visibleIds.has(id));
      if (firstVisibleIndex < 0) return;
      const lastVisibleIndex = itemOrder.findLastIndex((id) =>
        visibleIds.has(id),
      );
      const nextVisibleIds = new Set(
        itemOrder.slice(firstVisibleIndex, lastVisibleIndex + 1),
      );
      setVisibleItemIds((current) => {
        if (
          current.size === nextVisibleIds.size &&
          [...current].every((id) => nextVisibleIds.has(id))
        ) {
          return current;
        }
        return nextVisibleIds;
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const itemId = elementIds.get(entry.target);
          if (!itemId) continue;
          if (entry.isIntersecting) visibleIds.add(itemId);
          else visibleIds.delete(itemId);
        }
        publishVisibleIds();
      },
      { root, rootMargin: "-16px 0px 0px 0px" },
    );

    const syncObservedRows = (): void => {
      const mountedRows = new Set<Element>();
      for (const row of root.querySelectorAll<HTMLElement>(
        TURN_NAV_ROW_SELECTOR,
      )) {
        const itemId = row.dataset.turnNavigationId;
        if (!itemId || !itemIds.has(itemId)) continue;
        mountedRows.add(row);
        elementIds.set(row, itemId);
        if (!observedElements.has(row)) {
          observedElements.add(row);
          observer.observe(row);
        }
      }
      for (const row of observedElements) {
        if (mountedRows.has(row)) continue;
        const itemId = elementIds.get(row);
        if (itemId) visibleIds.delete(itemId);
        observedElements.delete(row);
        elementIds.delete(row);
        observer.unobserve(row);
      }
      publishVisibleIds();
    };

    const mutationObserver = new MutationObserver(syncObservedRows);
    mutationObserver.observe(root, { childList: true, subtree: true });
    syncObservedRows();

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [itemIdsKey, itemOrder, scrollRef]);

  const currentItemId =
    items.find((item) => visibleItemIds.has(item.id))?.id ??
    items.at(-1)?.id ??
    null;

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const button = currentItemId ? buttonRefs.current.get(currentItemId) : null;
    if (!list || !button) return;
    if (button.offsetTop < list.scrollTop) {
      list.scrollTop = button.offsetTop;
    } else if (
      button.offsetTop + button.offsetHeight >
      list.scrollTop + list.clientHeight
    ) {
      list.scrollTop =
        button.offsetTop + button.offsetHeight - list.clientHeight + 1;
    }
  }, [currentItemId]);

  React.useEffect(() => {
    if (!hasInlineClearance || items.length < MIN_TURN_NAV_ITEMS) return;
    const handleShortcut = (event: KeyboardEvent): void => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
        isEditableShortcutTarget(event.target)
      ) {
        return;
      }
      const currentIndex = Math.max(
        0,
        items.findIndex((item) => item.id === currentItemId),
      );
      const nextIndex =
        event.key === "ArrowUp"
          ? Math.max(0, currentIndex - 1)
          : Math.min(items.length - 1, currentIndex + 1);
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      onNavigate(items[nextIndex]!, "shortcut");
    };
    document.addEventListener("keydown", handleShortcut, true);
    return () => document.removeEventListener("keydown", handleShortcut, true);
  }, [currentItemId, hasInlineClearance, items, onNavigate]);

  const itemFromElement = React.useCallback(
    (element: Element | null): ConversationTurnNavItem | null => {
      const button = element?.closest<HTMLButtonElement>(
        TURN_NAV_BUTTON_SELECTOR,
      );
      if (!button || !listRef.current?.contains(button)) return null;
      return (
        items.find(
          (item) => item.id === button.dataset.turnNavigationItemId,
        ) ?? null
      );
    },
    [items],
  );

  const endScrub = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const session = scrubSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      scrubSessionRef.current = null;
      setScrubItemId(null);
      if (session.captureTarget.hasPointerCapture?.(event.pointerId)) {
        session.captureTarget.releasePointerCapture?.(event.pointerId);
      }
      if (session.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      if (
        !pointerInsideRailRef.current &&
        focusedItemIdRef.current === null
      ) {
        closePreview();
      }
    },
    [closePreview],
  );

  if (items.length < MIN_TURN_NAV_ITEMS) return null;

  if (!hasInlineClearance) {
    return <span ref={anchorRef} aria-hidden="true" hidden />;
  }

  return (
    <nav
      ref={anchorRef}
      aria-label="用户消息导航"
      className="conversation-turn-nav-rail"
      data-visible="true"
    >
      <div
        ref={listRef}
        className="conversation-turn-nav-list"
        data-scrubbing={scrubItemId !== null ? "" : undefined}
        onLostPointerCapture={endScrub}
        onPointerCancelCapture={endScrub}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return;
          const item = itemFromElement(
            event.target instanceof Element ? event.target : null,
          );
          const button = item ? buttonRefs.current.get(item.id) : null;
          if (!item || !button) return;
          pointerInsideRailRef.current = true;
          scrubSessionRef.current = {
            captureTarget: button,
            itemId: item.id,
            moved: false,
            pointerId: event.pointerId,
          };
          setScrubItemId(item.id);
          openPreview(item.id, true);
          button.setPointerCapture?.(event.pointerId);
        }}
        onPointerEnter={() => {
          pointerInsideRailRef.current = true;
        }}
        onPointerLeave={() => {
          pointerInsideRailRef.current = false;
          if (
            scrubSessionRef.current === null &&
            focusedItemIdRef.current === null
          ) {
            hoveredItemIdRef.current = null;
            closePreview();
          }
        }}
        onPointerMove={(event) => {
          const session = scrubSessionRef.current;
          if (!session || session.pointerId !== event.pointerId) return;
          if (event.buttons % 2 === 0) {
            endScrub(event);
            return;
          }
          const list = event.currentTarget;
          const rect = list.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            Math.max(rect.top, Math.min(event.clientY, rect.bottom - 1)),
          );
          const item = itemFromElement(hit);
          if (!item || item.id === session.itemId) return;
          session.itemId = item.id;
          session.moved = true;
          hoveredItemIdRef.current = item.id;
          setScrubItemId(item.id);
          openPreview(item.id, true);
          onNavigate(item, "scrub");
        }}
        onPointerUpCapture={endScrub}
      >
        <div className="conversation-turn-nav-items">
          {items.map((item, index) => {
            const isPreviewOpen = previewItemId === item.id;
            return (
              <Tooltip
                key={item.id}
                align="center"
                className="conversation-turn-preview-tooltip"
                content={<PreviewCard item={item} />}
                delayDuration={0}
                onOpenChange={(open) => {
                  if (!open && previewItemId === item.id) closePreview();
                }}
                open={isPreviewOpen}
                side="right"
                sideOffset={0}
                variant="unstyled"
              >
                <button
                  ref={(node) => {
                    if (node) buttonRefs.current.set(item.id, node);
                    else buttonRefs.current.delete(item.id);
                  }}
                  aria-current={
                    visibleItemIds.has(item.id) ? "true" : undefined
                  }
                  aria-label={`跳转到第 ${index + 1} 条用户消息`}
                  className="conversation-turn-nav-item"
                  data-scrub-target={
                    scrubItemId === item.id ? "" : undefined
                  }
                  data-turn-navigation-item-id={item.id}
                  onBlur={() => {
                    if (focusedItemIdRef.current === item.id) {
                      focusedItemIdRef.current = null;
                    }
                    if (scrubSessionRef.current === null) closePreview();
                  }}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    openPreview(item.id, true);
                    onNavigate(item, "activate");
                  }}
                  onFocus={() => {
                    focusedItemIdRef.current = item.id;
                    openPreview(item.id, true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    closePreview();
                  }}
                  onPointerEnter={() => {
                    hoveredItemIdRef.current = item.id;
                    openPreview(item.id, false);
                  }}
                  onPointerLeave={() => {
                    if (hoveredItemIdRef.current === item.id) {
                      hoveredItemIdRef.current = null;
                    }
                    if (
                      focusedItemIdRef.current !== item.id &&
                      scrubSessionRef.current === null
                    ) {
                      closePreview();
                    }
                  }}
                  type="button"
                >
                  <span className="conversation-turn-nav-marker" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
