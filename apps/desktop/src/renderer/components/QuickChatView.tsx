import type React from "react";
import { useState } from "react";
import { useQuickChatContext } from "../context/QuickChatContext.js";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover.js";
import type { DesktopWorkspace } from "../../shared/types.js";

export function QuickChatView(): React.ReactNode {
  const {
    workspaceName,
    workspacePath,
    recentWorkspaces,
    onChooseWorkspace,
    onOpenWorkspace,
    onClearWorkspace,
    composer,
  } = useQuickChatContext();
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const currentWorkspace: DesktopWorkspace | null = workspacePath
    ? recentWorkspaces.find(item => item.path === workspacePath) ?? null
    : null;
  const canSwitch = recentWorkspaces.length > 0 || Boolean(workspaceName);

  return (
    <section className="quick-chat-view">
      <div className="quick-chat-hero">
        {workspaceName ? (
          <h1>
            我们应该在{" "}
            <ProjectSwitcherPopover
              align="start"
              open={projectPopoverOpen}
              side="bottom"
              sideOffset={10}
              recentWorkspaces={recentWorkspaces}
              workspace={currentWorkspace}
              onChooseWorkspace={() => void onChooseWorkspace()}
              onOpenWorkspace={workspaceItem => void onOpenWorkspace(workspaceItem)}
              onClearWorkspace={onClearWorkspace}
              onOpenChange={setProjectPopoverOpen}
              trigger={
                <button
                  aria-expanded={projectPopoverOpen}
                  className="project-name"
                  disabled={!canSwitch}
                  onClick={() => canSwitch && setProjectPopoverOpen(true)}
                  title={canSwitch ? "点击切换项目" : "选择项目"}
                  type="button"
                >
                  {workspaceName}
                </button>
              }
            />{" "}
            中构建什么？
          </h1>
        ) : (
          <h1>我们该做什么？</h1>
        )}
      </div>

      {composer ? <div className="chat-composer">{composer}</div> : null}
    </section>
  );
}
