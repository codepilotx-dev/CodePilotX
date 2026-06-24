import type React from "react";
import { useState } from "react";
import {
  MessageSquare,
  HelpCircle,
  CheckSquare,
  type LucideIcon,
} from "lucide-react";
import { useQuickChatContext } from "../context/QuickChatContext.js";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover.js";
import { InlineApprovalCard } from "./InlineApprovalCard.js";
import { ExitPlanModeApproval } from "./ExitPlanModeApproval.js";
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from "./ui/iconTokens.js";
import type {
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopWorkspace,
} from "../../shared/types.js";

type DebugViewKey = "chat" | "permission" | "plan";

const DEBUG_VIEWS: { key: DebugViewKey; label: string; icon: LucideIcon }[] = [
  { key: "chat", label: "聊天输入", icon: MessageSquare },
  { key: "permission", label: "权限确认", icon: HelpCircle },
  { key: "plan", label: "计划确认", icon: CheckSquare },
];

const MOCK_PERMISSION_REQUEST: DesktopPermissionRequest = {
  requestId: "debug-permission-1",
  toolName: "Write",
  description: "需要在工作区外的桌面文档目录创建文件，是否允许执行？",
  input: {
    file_path: "C:\\Users\\XiaoHi\\Desktop\\文档\\测试.txt",
    content: "测试写入内容",
  },
};

const MOCK_EXIT_PLAN_REQUEST: DesktopPermissionRequest = {
  requestId: "debug-plan-1",
  toolName: "ExitPlanMode",
  description: "CodePilotX 已生成完整计划",
  input: {
    plan: "1. 更新 ChatInput 组件样式\n2. 更新 InlineApprovalCard 布局\n3. 添加调试工具栏\n4. 验证 typecheck 通过",
  },
};

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
  const [debugView, setDebugView] = useState<DebugViewKey>("chat");
  const [mockPermissionMode, setMockPermissionMode] =
    useState<DesktopPermissionMode>("default");
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

      <div className="home-debug-panel">
        {debugView === "chat" ? (
          composer ? (
            <div className="chat-composer">{composer}</div>
          ) : null
        ) : null}

        {debugView === "permission" ? (
          <div className="chat-composer">
            <InlineApprovalCard
              request={MOCK_PERMISSION_REQUEST}
              currentPermissionMode={mockPermissionMode}
              onDecide={(_request, behavior, _alwaysAllow, _updatedInput) => {
                console.log("[debug] permission decide", behavior);
              }}
              onAcceptExitPlanMode={() => undefined}
            />
          </div>
        ) : null}

        {debugView === "plan" ? (
          <div className="chat-composer">
            <section className="inline-approval-card" aria-label="接受计划">
              <ExitPlanModeApproval
                request={MOCK_EXIT_PLAN_REQUEST}
                currentMode={mockPermissionMode}
                onAccept={(nextMode, note) => {
                  console.log("[debug] plan accept", nextMode, note);
                  setMockPermissionMode(nextMode);
                }}
                onRevise={() => {
                  console.log("[debug] plan revise");
                }}
              />
            </section>
          </div>
        ) : null}
      </div>

      <div className="home-debug-toolbar" role="toolbar" aria-label="组件调试切换">
        {DEBUG_VIEWS.map(view => {
          const Icon = view.icon;
          const active = debugView === view.key;
          return (
            <button
              aria-pressed={active}
              className={
                active ? "home-debug-tool active" : "home-debug-tool"
              }
              key={view.key}
              onClick={() => setDebugView(view.key)}
              type="button"
            >
              <Icon
                className="home-debug-tool-icon"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
              <span className="home-debug-tool-label">{view.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
