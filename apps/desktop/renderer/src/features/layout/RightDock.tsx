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

  return (
    <>
      <aside
        className={resizing ? "right-dock resizing" : "right-dock"}
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
        <div className="right-dock-header">
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
        <div className="right-dock-content">
          {state.open && activePanelRenderer ? (
            activePanelRenderer(panelContext)
          ) : (
            <div className="right-dock-empty-state">
              <strong>右侧工具栏</strong>
              <span>使用 + 选择要打开的工具</span>
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
      <div className="right-dock-tab-list" role="tablist">
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
                      ? "right-dock-tab-wrap active"
                      : "right-dock-tab-wrap"
                  }
                  role="tab"
                  aria-selected={isActive}
                >
                       <span className="right-dock-tab-icon">{tool.icon}</span>
                  <button
                    className={
                      isActive ? "right-dock-tab active" : "right-dock-tab"
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
          <span className="right-dock-tab-empty">使用 + 添加工具</span>
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
              className="right-dock-add-button"
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
    <div ref={ref} className="desktop-workspace-fixed-controls">
      {showBottomPanel ? (
        <IconButton
          className="desktop-workspace-fixed-control-button"
          title={bottomPanelVisible ? "隐藏底部面板" : "显示底部面板"}
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
