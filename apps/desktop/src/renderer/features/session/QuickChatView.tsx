import { useMemo, useState } from "react";
import type React from "react";
import type { DesktopWorkspace } from "../../../shared/types.js";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover.js";
import { useQuickChatContext } from "./QuickChatContext.js";

export function QuickChatView(): React.ReactNode {
  const {
    branchName,
    composer,
    debugMode,
    recentWorkspaces,
    workspaceName,
    workspacePath,
    onChooseWorkspace,
    onClearWorkspace,
    onOpenWorkspace,
  } = useQuickChatContext();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const currentWorkspace = useMemo<DesktopWorkspace | null>(() => {
    if (!workspaceName || !workspacePath) return null;
    return (
      recentWorkspaces.find(workspace => workspace.path === workspacePath) ?? {
        name: workspaceName,
        path: workspacePath,
        branchName,
      }
    );
  }, [branchName, recentWorkspaces, workspaceName, workspacePath]);

  return (
    <div className="quick-chat-view">
      <div className="quick-chat-hero">
        {workspaceName ? (
          <h1>
            我们应该在{" "}
            <ProjectSwitcherPopover
              align="center"
              className="popover-project quick-chat-project-popover"
              disableOutsideDismiss={debugMode}
              maxWidth="min(420px, calc(100vw - 48px))"
              open={projectMenuOpen}
              recentWorkspaces={recentWorkspaces}
              side="bottom"
              sideOffset={10}
              trigger={
                <button
                  aria-label="选择项目"
                  className="project-name"
                  type="button"
                >
                  {workspaceName}
                </button>
              }
              width="min(380px, calc(100vw - 64px))"
              workspace={currentWorkspace}
              onChooseWorkspace={() => {
                void onChooseWorkspace();
                setProjectMenuOpen(false);
              }}
              onClearWorkspace={() => {
                onClearWorkspace();
                setProjectMenuOpen(false);
              }}
              onOpenChange={setProjectMenuOpen}
              onOpenWorkspace={workspace => {
                void onOpenWorkspace(workspace);
                setProjectMenuOpen(false);
              }}
            />
            {" "}
            中构建什么？
          </h1>
        ) : (
          <h1>我们该做什么？</h1>
        )}
      </div>

      {composer ? <div className="chat-composer">{composer}</div> : null}
    </div>
  );
}
