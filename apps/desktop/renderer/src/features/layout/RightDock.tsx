import type React from "react";
import { forwardRef, Fragment, useEffect, useMemo, useState } from "react";
import { PanelBottom, PanelRight, Plus, X } from "lucide-react";
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
import type { RightDockState } from "./rightDockState.js";
import {
  SIDEBAR_COLLAPSE_HOLD_MS,
  SIDEBAR_COLLAPSE_TARGET_SIZE,
  useSidebarResizeCollapseConfirm,
} from "./useSidebarResizeCollapseConfirm.js";

type Props = {
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
  environmentContent: React.ReactNode | null;
  width: number;
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
  onSelectTool: (tool: RightDockToolId) => void;
  onSetWidth: (width: number) => void;
  onToggleReviewView: () => void;
  // side chat
  sideChatComposer: React.ReactNode;
  sideChatFocusVersion: number;
  sideChatContent?: React.ReactNode;
};

type RightDockTabsHeaderProps = {
  state: RightDockState;
  debugMode?: boolean;
  quickChatOnly?: boolean;
  plan: RightDockPlan | null;
  onCloseTool: (tool: RightDockToolId) => void;
  onOpenTool: (tool: RightDockToolId) => void;
  onSelectTool: (tool: RightDockToolId) => void;
};

export function RightDock({
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
  environmentContent,
  width,
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
  onSelectTool,
  onSetWidth,
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

  const panelContext = useMemo<RightDockPanelContext>(
    () => ({
      environment: {
        content: environmentContent,
      },
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
      environmentContent,
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

  return (
    <>
      <aside
        className={
          resizing
            ? "right-dock resizing tw:relative tw:flex tw:h-full tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-col tw:overflow-hidden tw:border-l tw:border-app-border tw:bg-app-chrome tw:text-app-text"
            : "right-dock tw:relative tw:flex tw:h-full tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-col tw:overflow-hidden tw:border-l tw:border-app-border tw:bg-app-chrome tw:text-app-text"
        }
        aria-label="右侧工具栏"
      >
        <div
          aria-label="调整右侧栏宽度"
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
        <div className="right-dock-header tw:flex tw:h-[46px] tw:max-h-[46px] tw:shrink-0 tw:items-center tw:overflow-hidden tw:border-b tw:border-app-border tw:bg-app-chrome tw:pr-[92px] tw:pl-2.5">
          <RightDockTabsHeader
            state={state}
            debugMode={debugMode}
            quickChatOnly={quickChatOnly}
            plan={plan}
            onCloseTool={onCloseTool}
            onOpenTool={onOpenTool}
            onSelectTool={onSelectTool}
          />
        </div>
        <div className="right-dock-content tw:flex tw:min-h-0 tw:flex-1 tw:overflow-hidden tw:bg-app-canvas">
          {state.open && activePanelRenderer ? (
            activePanelRenderer(panelContext)
          ) : (
            <div className="right-dock-empty-state tw:grid tw:h-full tw:w-full tw:min-w-0 tw:place-content-center tw:justify-items-center tw:gap-2 tw:p-6 tw:text-center tw:text-app-text-soft">
              <strong className="tw:text-base tw:font-[var(--font-weight-label)] tw:text-app-text">右侧工具栏</strong>
              <span className="tw:max-w-full tw:text-sm tw:text-app-text-soft">使用 + 选择要打开的工具</span>
            </div>
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
  state,
  debugMode = false,
  quickChatOnly = false,
  plan,
  onCloseTool,
  onOpenTool,
  onSelectTool,
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
                  className={
                    isActive
                      ? "right-dock-tab-wrap active tw:relative tw:flex tw:h-7 tw:min-w-0 tw:max-w-[156px] tw:flex-[0_1_auto] tw:items-center tw:gap-1 tw:overflow-hidden tw:rounded-[10px] tw:bg-app-panel tw:px-1 tw:text-app-text"
                      : "right-dock-tab-wrap tw:relative tw:flex tw:h-7 tw:min-w-0 tw:max-w-[156px] tw:flex-[0_1_auto] tw:items-center tw:gap-1 tw:overflow-hidden tw:rounded-[10px] tw:px-1 tw:text-app-text-soft tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-app-panel tw:hover:text-app-text"
                  }
                  role="tab"
                  aria-selected={isActive}
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
          <span className="right-dock-tab-empty tw:min-w-0 tw:flex-1 tw:truncate tw:px-2 tw:text-xs tw:text-app-text-soft">使用 + 添加工具</span>
        )}
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
      </div>
    </>
  );
}

export type DesktopWorkspaceFixedControlsProps = {
  rightDockState: RightDockState;
  bottomPanelVisible: boolean;
  showBottomPanel: boolean;
  onToggleBottomPanel: () => void;
  onOpenRightDockTool: (tool: RightDockToolId) => void;
  onCloseRightDock: () => void;
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
    onOpenRightDockTool,
    onCloseRightDock,
  }: DesktopWorkspaceFixedControlsProps,
  ref,
): React.ReactNode {
  return (
    <div ref={ref} className="desktop-workspace-fixed-controls tw:flex tw:h-full tw:max-h-[46px] tw:items-center tw:gap-0.5 tw:pr-3">
      {showBottomPanel ? (
        <IconButton
          className="desktop-workspace-fixed-control-button"
          title={bottomPanelVisible ? "隐藏底部面板" : "显示底部面板"}
          variant="plain"
          onClick={onToggleBottomPanel}
        >
          <PanelBottom
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </IconButton>
      ) : null}
      <IconButton
        className="desktop-workspace-fixed-control-button"
        title={rightDockState.open ? "关闭右侧面板" : "显示右侧面板"}
        variant="plain"
        onClick={() => {
          if (rightDockState.open) {
            onCloseRightDock();
          } else {
            onOpenRightDockTool(rightDockState.activeTool ?? "review");
          }
        }}
      >
        <PanelRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </IconButton>
    </div>
  );
});
