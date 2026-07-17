import type React from "react";
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Maximize2, Minimize2, MoveDown, MoveRight, Plus, X } from "lucide-react";
import type {
  DesktopBrowserState,
  DesktopDiffMarkerStyle,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from "../../../shared/types.js";
import { desktopClient } from "../../services/desktopClient.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { IconButton } from "../../components/ui/IconButton.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import type {
  RightDockPanelContext,
  RightDockPlan,
  RightDockToolId,
} from "./rightDockTools.js";
import {
  getRightDockTool,
  getVisibleRightDockTools,
  isRightDockToolEnabled,
} from "./rightDockTools.js";
import { rightDockPanelRenderers } from "./rightDockPanelRenderers.js";
import type {
  RightDockState,
  WorkbenchPanelTarget,
} from "./rightDockState.js";
import {
  SIDEBAR_COLLAPSE_HOLD_MS,
  SIDEBAR_COLLAPSE_TARGET_SIZE,
  useSidebarResizeCollapseConfirm,
} from "./useSidebarResizeCollapseConfirm.js";

type Props = {
  target: WorkbenchPanelTarget;
  state: RightDockState;
  browserState: DesktopBrowserState | null;
  debugMode?: boolean;
  defaultBranch: string | null;
  files: DesktopFileEntry[];
  gitStatus: DesktopGitStatus | null;
  isRefreshingReview: boolean;
  diffMarkerStyle: DesktopDiffMarkerStyle;
  maxWidth: number;
  minWidth: number;
  reviewView: DesktopReviewView;
  selectedFile: DesktopFilePreview | null;
  sessionId: string | null;
  sessionStatus: DesktopSessionStatus;
  plan: RightDockPlan | null;
  width: number;
  height?: number;
  rightFullWidth?: boolean;
  workspace: DesktopWorkspace | null;
  quickChatOnly?: boolean;
  onAppendBrowserAnnotation: (text: string) => void;
  onBrowserStateChange: (state: DesktopBrowserState) => void;
  onClose: () => void;
  onCloseTool: (tool: RightDockToolId) => void;
  onCreateBranch: () => void;
  onOpenTool: (tool: RightDockToolId) => void;
  onOpenWorkspacePath: () => void;
  onPreviewFile: (file: DesktopFileEntry) => void;
  onAppendComposerText: (text: string) => void;
  onAddComposerFiles: (filePaths: string[]) => void;
  onRefreshReview: () => void;
  onResetWidth: () => void;
  onResetHeight?: () => void;
  onSelectTool: (tool: RightDockToolId) => void;
  onSetWidth: (width: number) => void;
  onSetHeight?: (height: number) => void;
  onMoveTool: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tool: RightDockToolId,
    index?: number,
  ) => void;
  onReorderTool: (
    target: WorkbenchPanelTarget,
    tool: RightDockToolId,
    index: number,
  ) => void;
  onToggleRightFullWidth?: () => void;
  onToggleReviewView: () => void;
  // side chat
  sideChatComposer: React.ReactNode;
  sideChatFocusVersion: number;
  sideChatContent?: React.ReactNode;
};

type RightDockTabsHeaderProps = {
  target: WorkbenchPanelTarget;
  state: RightDockState;
  debugMode?: boolean;
  quickChatOnly?: boolean;
  plan: RightDockPlan | null;
  onCloseTool: (tool: RightDockToolId) => void;
  onOpenTool: (tool: RightDockToolId) => void;
  onSelectTool: (tool: RightDockToolId) => void;
  onMoveTool: Props["onMoveTool"];
  onReorderTool: Props["onReorderTool"];
};

export function WorkbenchPanel({
  target,
  state,
  browserState,
  debugMode = false,
  defaultBranch,
  files,
  gitStatus,
  isRefreshingReview,
  diffMarkerStyle,
  maxWidth,
  minWidth,
  reviewView,
  selectedFile,
  sessionId,
  sessionStatus,
  plan,
  width,
  height,
  rightFullWidth = false,
  workspace,
  quickChatOnly = false,
  onAppendBrowserAnnotation,
  onBrowserStateChange,
  onClose,
  onCloseTool,
  onCreateBranch,
  onOpenTool,
  onOpenWorkspacePath,
  onPreviewFile,
  onAppendComposerText,
  onAddComposerFiles,
  onRefreshReview,
  onResetWidth,
  onResetHeight,
  onSelectTool,
  onSetWidth,
  onSetHeight,
  onMoveTool,
  onReorderTool,
  onToggleRightFullWidth,
  onToggleReviewView,
  sideChatComposer,
  sideChatFocusVersion,
  sideChatContent,
}: Props): React.ReactNode {
  const flags = useMemo<RightDockPanelContext["flags"]>(
    () => ({ debugMode, quickChatOnly }),
    [debugMode, quickChatOnly],
  );

  const {
    collapseConfirmKey,
    collapseConfirmTarget,
    handleResizeKey,
    resizing,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed: false,
    maxWidth,
    minWidth,
    width,
    onCollapse: onClose,
    onSetWidth,
    direction: "right",
  });
  const startBottomResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (target !== "bottom" || !onSetHeight || height === undefined) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height;
      const onPointerMove = (moveEvent: PointerEvent): void => {
        onSetHeight(startHeight + startY - moveEvent.clientY);
      };
      const onPointerUp = (): void => {
        document.body.classList.remove("bottom-panel-is-resizing");
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      document.body.classList.add("bottom-panel-is-resizing");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [height, onSetHeight, target],
  );
  const handleBottomResizeKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (target !== "bottom" || !onSetHeight || height === undefined) return;
      const step = event.shiftKey ? 40 : 10;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onSetHeight(height + step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        onSetHeight(height - step);
      } else if (event.key === "Home") {
        event.preventDefault();
        onResetHeight?.();
      }
    },
    [height, onResetHeight, onSetHeight, target],
  );

  const panelContext = useMemo<RightDockPanelContext>(
    () => ({
      review: {
        activeSessionId: sessionId,
        defaultBranch,
        gitStatus,
        isRefreshing: isRefreshingReview,
        diffMarkerStyle,
        reviewView,
        sessionStatus,
        workspacePath: workspace?.path ?? null,
        onAppendComposerText,
        onClose,
        onCreateBranch,
        onOpenWorkspacePath,
        onRefreshDiff: onRefreshReview,
        onToggleReviewView,
      },
      browser: {
        state: browserState,
        onAppendAnnotation: onAppendBrowserAnnotation,
        onAppendComposerText,
        onStateChange: onBrowserStateChange,
      },
      files: {
        files,
        selectedFile,
        workspace,
        onPreviewFile,
        onAppendComposerText,
        onAddComposerFiles,
      },
      plan,
      flags,
      sideChat: {
        composer: sideChatComposer,
        focusVersion: sideChatFocusVersion,
        content: sideChatContent,
      },
    }),
    [
      browserState,
      defaultBranch,
      files,
      flags,
      gitStatus,
      isRefreshingReview,
      diffMarkerStyle,
      onAppendBrowserAnnotation,
      onBrowserStateChange,
      onClose,
      onCreateBranch,
      onAppendComposerText,
      onAddComposerFiles,
      onOpenWorkspacePath,
      onRefreshReview,
      onToggleReviewView,
      plan,
      reviewView,
      selectedFile,
      sessionId,
      sessionStatus,
      sideChatComposer,
      sideChatContent,
      sideChatFocusVersion,
      workspace,
    ],
  );

  useEffect(() => {
    if (!state.open || state.activeTool !== "browser") {
      void desktopClient
        .setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 })
        .then(onBrowserStateChange)
        .catch(() => undefined);
    }
  }, [onBrowserStateChange, state.activeTool, state.open]);

  const activePanelRenderer = state.activeTool
    ? rightDockPanelRenderers[state.activeTool]
    : null;
  const launcherTools = useMemo(() => {
    const labels: Partial<Record<RightDockToolId, string>> = {
      review: "审阅",
      files: "文件",
      sideChat: "侧边任务",
    };
    const order: readonly RightDockToolId[] = [
      "review",
      "terminal",
      "browser",
      "files",
      "sideChat",
    ];
    return order
      .map(id => getRightDockTool(id))
      .filter(
        (tool): tool is NonNullable<ReturnType<typeof getRightDockTool>> =>
          Boolean(tool) && isRightDockToolEnabled(tool.id, flags),
      )
      .map(tool => ({ ...tool, label: labels[tool.id] ?? tool.label }));
  }, [flags]);

  return (
    <>
      <aside
        className={`${target === "right" ? "right-dock" : "bottom-panel"}${resizing && target === "right" ? " resizing" : ""} workbench-panel`}
        aria-label={target === "right" ? "右侧面板" : "底部面板"}
        data-workbench-panel-target={target}
      >
        {target === "right" ? (
          <div
            aria-label="调整右侧面板宽度"
            aria-orientation="vertical"
            aria-valuemax={maxWidth}
            aria-valuemin={minWidth}
            aria-valuenow={width}
            className="right-dock-resize-handle"
            role="separator"
            tabIndex={0}
            title="拖拽调整宽度，双击恢复默认宽度"
            onDoubleClick={onResetWidth}
            onKeyDown={handleResizeKey}
            onPointerDown={startResize}
          />
        ) : (
          <div
            aria-label="调整底部面板高度"
            aria-orientation="horizontal"
            aria-valuemax={Math.floor(window.innerHeight * 0.5)}
            aria-valuemin={160}
            aria-valuenow={height}
            className="bottom-panel-resize-handle"
            role="separator"
            tabIndex={0}
            title="拖拽调整高度，双击恢复默认高度"
            onDoubleClick={onResetHeight}
            onKeyDown={handleBottomResizeKey}
            onPointerDown={startBottomResize}
          />
        )}
        <div className={`${target === "right" ? "right-dock-header" : "bottom-panel-header"} workbench-panel-header`}>
          <RightDockTabsHeader
            target={target}
            state={state}
            debugMode={debugMode}
            quickChatOnly={quickChatOnly}
            plan={plan}
            onCloseTool={onCloseTool}
            onOpenTool={onOpenTool}
            onSelectTool={onSelectTool}
            onMoveTool={onMoveTool}
            onReorderTool={onReorderTool}
          />
          {target === "right" && onToggleRightFullWidth ? (
            <IconButton
              aria-pressed={rightFullWidth}
              className="right-dock-full-width"
              title={rightFullWidth ? "恢复右侧面板宽度" : "展开右侧面板"}
              variant="plain"
              onClick={onToggleRightFullWidth}
            >
              {rightFullWidth ? (
                <Minimize2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              ) : (
                <Maximize2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
            </IconButton>
          ) : null}
        </div>
        <div
          className="right-dock-content workbench-panel-content"
          data-app-shell-tab-panel-controller={target}
          role="tabpanel"
          tabIndex={-1}
        >
          {state.open && activePanelRenderer ? (
            activePanelRenderer(panelContext)
          ) : target === "right" ? (
            <div
              className="right-panel-tabs-empty-state"
              aria-label="可用面板标签"
            >
              <div className="right-panel-tabs-empty-state__actions">
              {launcherTools.map(tool => (
                <button
                  key={tool.id}
                  className="right-panel-tabs-empty-state__item"
                  type="button"
                  onClick={() => onOpenTool(tool.id)}
                >
                  <span className="right-panel-tabs-empty-state__icon">
                    {tool.icon}
                  </span>
                  <strong>{tool.label}</strong>
                  {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
                </button>
              ))}
              </div>
            </div>
          ) : (
            <div className="bottom-panel-empty-state" />
          )}
        </div>
      </aside>
      {collapseConfirmTarget ? (
        <div
          key={collapseConfirmKey}
          aria-hidden="true"
          className="sidebar-collapse-confirm-target"
          style={
            {
              "--sidebar-collapse-target-ms": `${SIDEBAR_COLLAPSE_HOLD_MS}ms`,
              "--sidebar-collapse-target-size": `${SIDEBAR_COLLAPSE_TARGET_SIZE}px`,
              left: `${collapseConfirmTarget.x}px`,
              top: `${collapseConfirmTarget.y}px`,
            } as React.CSSProperties
          }
        />
      ) : null}
    </>
  );
}

function RightDockTabsHeader({
  target,
  state,
  debugMode = false,
  quickChatOnly = false,
  plan,
  onCloseTool,
  onOpenTool,
  onSelectTool,
  onMoveTool,
  onReorderTool,
}: RightDockTabsHeaderProps): React.ReactNode {
  const flags = useMemo<RightDockPanelContext["flags"]>(
    () => ({ debugMode, quickChatOnly }),
    [debugMode, quickChatOnly],
  );
  const visibleTools = useMemo(() => getVisibleRightDockTools(flags), [flags]);
  const visibleToolIds = useMemo(
    () => new Set(visibleTools.map((tool) => tool.id)),
    [visibleTools],
  );
  const openedTools = useMemo(
    () =>
      state.openTools
        .map((id) => getRightDockTool(id))
        .filter(
          (tool): tool is NonNullable<ReturnType<typeof getRightDockTool>> =>
            Boolean(tool) &&
            visibleToolIds.has(tool.id) &&
            isRightDockToolEnabled(tool.id, flags),
        ),
    [flags, state.openTools, visibleToolIds],
  );
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div className="right-dock-tab-list tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1 tw:overflow-hidden" role="tablist">
        {openedTools.length > 0 ? (
          openedTools.map((tool, index) => {
            const isActive = state.activeTool === tool.id;
            const label = tool.label;
            return (
              <Fragment key={tool.id}>
                {index > 0 ? <span className="right-dock-tab-divider" /> : null}
                <div
                  draggable
                  data-panel-tool={tool.id}
                  className={
                    isActive
                      ? "right-dock-tab-wrap active tw:relative tw:flex tw:h-7 tw:min-w-0 tw:max-w-[156px] tw:flex-[0_1_auto] tw:items-center tw:gap-1 tw:overflow-hidden tw:rounded-[10px] tw:bg-app-panel tw:px-1 tw:text-app-text"
                      : "right-dock-tab-wrap tw:relative tw:flex tw:h-7 tw:min-w-0 tw:max-w-[156px] tw:flex-[0_1_auto] tw:items-center tw:gap-1 tw:overflow-hidden tw:rounded-[10px] tw:px-1 tw:text-app-text-soft tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-app-panel tw:hover:text-app-text"
                  }
                  role="tab"
                  aria-selected={isActive}
                  onDragEnd={(event) => {
                    event.currentTarget.classList.remove("dragging");
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDragStart={(event) => {
                    event.currentTarget.classList.add("dragging");
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      "application/x-codepilotx-panel-tool",
                      JSON.stringify({ source: target, tool: tool.id }),
                    );
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const raw = event.dataTransfer.getData(
                      "application/x-codepilotx-panel-tool",
                    );
                    try {
                      const payload = JSON.parse(raw) as {
                        source: WorkbenchPanelTarget;
                        tool: RightDockToolId;
                      };
                      if (payload.source === target) {
                        onReorderTool(target, payload.tool, index);
                      } else {
                        onMoveTool(payload.source, target, payload.tool, index);
                      }
                    } catch {
                      /* Ignore unrelated drag payloads. */
                    }
                  }}
                >
                       <span className="right-dock-tab-icon">{tool.icon}</span>
                  <button
                    className={
                      isActive
                        ? "right-dock-tab active tw:min-w-0 tw:flex-1 tw:truncate tw:px-1 tw:py-0 tw:text-sm tw:text-app-text"
                        : "right-dock-tab tw:min-w-0 tw:flex-1 tw:truncate tw:px-1 tw:py-0 tw:text-sm tw:text-app-text-soft"
                    }
                    title={label}
                    type="button"
                    onClick={() => onSelectTool(tool.id)}
                  >
                    <span>{label}</span>
                  </button>
                  <IconButton
                    aria-label={`移到${target === "right" ? "底部" : "右侧"}面板`}
                    className="right-dock-tab-move"
                    title={`移到${target === "right" ? "底部" : "右侧"}面板`}
                    variant="plain"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveTool(
                        target,
                        target === "right" ? "bottom" : "right",
                        tool.id,
                      );
                    }}
                  >
                    {target === "right" ? (
                      <MoveDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    ) : (
                      <MoveRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    )}
                  </IconButton>
                  <IconButton
                    className="right-dock-tab-close"
                    title={`关闭 ${label}`}
                    variant="plain"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTool(tool.id);
                    }}
                  >
                    <X
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </IconButton>
                </div>
              </Fragment>
            );
          })
        ) : (
          <span
            aria-hidden="true"
            className="right-dock-tab-empty tw:min-w-0 tw:flex-1"
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              const raw = event.dataTransfer.getData(
                "application/x-codepilotx-panel-tool",
              );
              try {
                const payload = JSON.parse(raw) as {
                  source: WorkbenchPanelTarget;
                  tool: RightDockToolId;
                };
                if (payload.source !== target) {
                  onMoveTool(payload.source, target, payload.tool);
                }
              } catch {
                /* Ignore unrelated drag payloads. */
              }
            }}
          />
        )}
        {target === "bottom" || openedTools.length > 0 ? (
        <PopoverMenu
          align="end"
          avoidCollisions={false}
          className="popover-right-dock-add"
          collisionPadding={44}
          open={menuOpen}
          side="bottom"
          sideOffset={12}
          width={220}
          trigger={
            <button
              className="right-dock-add-button tw:flex tw:size-7 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-md tw:text-app-text-soft tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-app-panel tw:hover:text-app-text tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent"
              type="button"
              title="添加工具"
            >
              <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          }
          onOpenChange={setMenuOpen}
        >
          {visibleTools.map((tool) => {
            const opened = state.openTools.includes(tool.id);
            const isActive = state.activeTool === tool.id;
            return (
              <PopoverItem
                key={tool.id}
                active={isActive}
                icon={tool.icon}
                selected={opened}
                shortcut={tool.shortcut}
                onClick={() => {
                  if (opened) {
                    onSelectTool(tool.id);
                  } else {
                    onOpenTool(tool.id);
                  }
                  setMenuOpen(false);
                }}
              >
                {tool.label}
              </PopoverItem>
            );
          })}
        </PopoverMenu>
        ) : null}
      </div>
    </>
  );
}

export type DesktopWorkspaceFixedControlsProps = {
  rightDockState: RightDockState;
  bottomPanelVisible: boolean;
  showBottomPanel: boolean;
  onToggleBottomPanel: () => void;
  onToggleRightPanel: () => void;
};

export const DesktopWorkspaceFixedControls = forwardRef<
  HTMLDivElement,
  DesktopWorkspaceFixedControlsProps
>(function DesktopWorkspaceFixedControls(
  {
    rightDockState,
    bottomPanelVisible,
    showBottomPanel,
    onToggleBottomPanel,
    onToggleRightPanel,
  }: DesktopWorkspaceFixedControlsProps,
  ref,
): React.ReactNode {
  return (
    <div ref={ref} className="desktop-workspace-fixed-controls tw:flex tw:h-full tw:max-h-[46px] tw:items-center tw:gap-0.5 tw:pr-3">
      {showBottomPanel ? (
        <IconButton
          aria-pressed={bottomPanelVisible}
          className="desktop-workspace-fixed-control-button"
          title={bottomPanelVisible ? "隐藏底部面板" : "显示底部面板"}
          variant="plain"
          onClick={onToggleBottomPanel}
        >
          <BottomPanelToggleIcon open={bottomPanelVisible} />
        </IconButton>
      ) : null}
      <IconButton
        aria-pressed={rightDockState.open}
        className="desktop-workspace-fixed-control-button"
        title={rightDockState.open ? "关闭右侧面板" : "显示右侧面板"}
        variant="plain"
        onClick={() => {
          onToggleRightPanel();
        }}
      >
        <RightPanelToggleIcon open={rightDockState.open} />
      </IconButton>
    </div>
  );
});

function BottomPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20">
      <rect height="14" rx="2.5" stroke="currentColor" width="16" x="2" y="3" />
      <path
        d={open ? "M2.5 12.25h15" : "M7 12.9h6"}
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RightPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20">
      <rect height="14" rx="2.5" stroke="currentColor" width="16" x="2" y="3" />
      <path
        d={open ? "M12.25 3.5v13" : "M12.9 7v6"}
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  );
}
