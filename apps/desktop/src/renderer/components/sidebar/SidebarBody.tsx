import type React from "react";
import { MoreHorizontal, SquarePen } from "lucide-react";
import type { DesktopWorkspace } from "../../../shared/types.js";
import type { SessionListItem } from "../../uiTypes.js";
import { IconButton } from "../ui/IconButton.js";
import { SidebarProjectGroup } from "./SidebarProjectGroup.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";

type Props = {
  activeSessionId: string | null;
  expandedGroups: Record<string, boolean>;
  now: number;
  pinnedSessions: SessionListItem[];
  projectWorkspaces: DesktopWorkspace[];
  standaloneSessions: SessionListItem[];
  unpinnedSessions: SessionListItem[];
  workspace: DesktopWorkspace | null;
  onArchiveSession: (session: SessionListItem) => void;
  onChooseWorkspace: () => void;
  onCreateSession: () => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleExpanded: (groupKey: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarBody({
  activeSessionId,
  expandedGroups,
  now,
  pinnedSessions,
  projectWorkspaces,
  standaloneSessions,
  unpinnedSessions,
  workspace,
  onArchiveSession,
  onChooseWorkspace,
  onCreateSession,
  onOpenWorkspace,
  onPinSession,
  onSelectSession,
  onToggleExpanded,
  onUnpinSession,
}: Props): React.ReactNode {
  return (
    <div className="sidebar-body">
      {pinnedSessions.length > 0 ? (
        <section className="sidebar-section">
          <h2 className="sidebar-section-title">置顶</h2>
          <SidebarSessionGroup
            activeSessionId={activeSessionId}
            groupKey="pinned"
            isExpanded={expandedGroups.pinned === true}
            now={now}
            sessions={pinnedSessions}
            onArchiveSession={onArchiveSession}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleExpanded={onToggleExpanded}
            onUnpinSession={onUnpinSession}
          />
        </section>
      ) : null}

      <section className="sidebar-section sidebar-projects-section">
        <SidebarSectionHeader
          title="项目"
          onChooseWorkspace={onChooseWorkspace}
          onCreateSession={onCreateSession}
          createDisabled={!workspace}
        />
        {projectWorkspaces.length === 0 ? (
          <p className="sidebar-empty">暂无最近项目</p>
        ) : (
          projectWorkspaces.map((project) => (
            <SidebarProjectGroup
              activeSessionId={activeSessionId}
              expandedGroups={expandedGroups}
              key={project.path}
              now={now}
              project={project}
              sessions={unpinnedSessions}
              workspace={workspace}
              onArchiveSession={onArchiveSession}
              onCreateSession={onCreateSession}
              onOpenWorkspace={onOpenWorkspace}
              onPinSession={onPinSession}
              onSelectSession={onSelectSession}
              onToggleExpanded={onToggleExpanded}
              onUnpinSession={onUnpinSession}
            />
          ))
        )}
      </section>

      <section className="sidebar-section">
        <SidebarSectionHeader
          title="对话"
          onChooseWorkspace={onChooseWorkspace}
          onCreateSession={onCreateSession}
        />
        {standaloneSessions.length === 0 ? (
          <p className="sidebar-empty">暂无对话</p>
        ) : (
          <SidebarSessionGroup
            activeSessionId={activeSessionId}
            groupKey="standalone"
            isExpanded={expandedGroups.standalone === true}
            now={now}
            sessions={standaloneSessions}
            onArchiveSession={onArchiveSession}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleExpanded={onToggleExpanded}
            onUnpinSession={onUnpinSession}
          />
        )}
      </section>
    </div>
  );
}

function SidebarSectionHeader({
  createDisabled,
  title,
  onChooseWorkspace,
  onCreateSession,
}: {
  createDisabled?: boolean;
  title: string;
  onChooseWorkspace: () => void;
  onCreateSession: () => void;
}): React.ReactNode {
  return (
    <div className="sidebar-section-header">
      <h2 className="sidebar-section-title">{title}</h2>
      <div className="sidebar-section-actions">
        <IconButton onClick={onChooseWorkspace} title="更多">
          <MoreHorizontal size={15} />
        </IconButton>
        <IconButton
          disabled={createDisabled}
          onClick={onCreateSession}
          title="新建对话"
        >
          <SquarePen size={15} />
        </IconButton>
      </div>
    </div>
  );
}
