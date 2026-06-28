import type { ReactNode } from "react";
import {
  Goal,
  Bot,
  FileText,
  GitFork,
  GitPullRequest,
  Globe2,
  Handshake,
  ListChecks,
  MessageSquarePlus,
  PlugZap,
  Search,
  SquareTerminal,
  TimerReset,
} from "lucide-react";
import type {
  DesktopAgentPickerEntry,
  DesktopBrowserState,
  DesktopCollaborationModePreset,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopBackgroundTerminal,
  DesktopGitStatus,
  DesktopContextUsage,
  DesktopHookListEntry,
  DesktopThreadGoal,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from "../../../shared/types.js";
import type { SessionListItem } from "../../uiTypes.js";

export type RightDockToolId =
  | "review"
  | "browser"
  | "goal"
  | "plan"
  | "files"
  | "sideChat"
  | "terminal"
  | "agents"
  | "hooks"
  | "sessions"
  | "tokenUsage"
  | "collaboration"
  | "toolProbe";

export type RightDockFlags = {
  debugMode: boolean;
};

export type RightDockPanelContext = {
  review: {
    activeSessionId: string | null;
    defaultBranch: string | null;
    gitStatus: DesktopGitStatus | null;
    isRefreshing: boolean;
    reviewView: DesktopReviewView;
    sessionStatus: DesktopSessionStatus;
    workspacePath: string | null;
    onClose: () => void;
    onCreateBranch: () => void;
    onOpenWorkspacePath: () => void;
    onRefreshDiff: () => void;
    onToggleReviewView: () => void;
  };
  browser: {
    state: DesktopBrowserState | null;
    onAppendAnnotation: (text: string) => void;
    onStateChange: (state: DesktopBrowserState) => void;
  };
  files: {
    files: DesktopFileEntry[];
    selectedFile: DesktopFilePreview | null;
    workspace: DesktopWorkspace | null;
    onPreviewFile: (file: DesktopFileEntry) => void;
  };
  goal: {
    goal: DesktopThreadGoal | null;
    sessionId: string | null;
    sessionStatus: DesktopSessionStatus;
    loading: boolean;
    saving: boolean;
    onRefresh: () => void;
    onSave: (input: {
      objective?: string | null;
      status?: DesktopThreadGoal["status"] | null;
      tokenBudget?: number | null;
    }) => Promise<void>;
    onClear: () => Promise<void>;
  };
  terminal: {
    sessionId: string | null;
    terminals: DesktopBackgroundTerminal[];
    loading: boolean;
    onRefresh: () => void;
    onTerminate: (processId: string) => Promise<void>;
    onClean: () => Promise<void>;
  };
  agents: RightDockAgentsContext;
  hooks: RightDockHooksContext;
  sessions: RightDockSessionsContext;
  tokenUsage: {
    contextUsage: DesktopContextUsage | null;
  };
  collaboration: RightDockCollaborationContext;
  plan: RightDockPlan | null;
  flags: RightDockFlags;
};

export type RightDockAgentsContext = {
  activeAgentId: string | null;
  agents: DesktopAgentPickerEntry[];
  inputDisabled: boolean;
  onSelectAgent: (agentId: string) => void;
  onRefreshAgents: () => void;
  onSendAgentInput: (agentId: string, input: string) => void;
  onInterruptAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
  onResumeAgent: (agentId: string) => void;
  onForkAgent: (agentId: string, input: string) => void;
};

export type RightDockHooksContext = {
  entries: DesktopHookListEntry[];
  loading: boolean;
  onRefreshHooks: () => void;
  onTrustHook: (input: {
    cwd: string;
    hookKey: string;
    currentHash: string;
  }) => void;
};

export type RightDockLineageEntry = {
  id: string;
  title: string;
  subtitle?: string | null;
  cwd?: string | null;
  status?: string | null;
  createdAt?: string | null;
};

export type RightDockSessionsContext = {
  activeSessionId: string | null;
  sessions: SessionListItem[];
  lineage: RightDockLineageEntry[];
  onResumeSession: (sessionId: string) => void;
  onForkSession: (sessionId: string) => void;
};

export type RightDockCollaborationContext = {
  presets: DesktopCollaborationModePreset[];
  selectedPresetName: string | null;
  available: boolean;
  experimental: boolean;
  onSelectPreset: (presetName: string) => void;
};

export type RightDockPlan = {
  title: string;
  content: string;
};

export type RightDockToolMeta = {
  id: RightDockToolId;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  enabled: boolean | ((flags: RightDockFlags) => boolean);
};

const iconSize = 14;

export const rightDockTools: readonly RightDockToolMeta[] = [
  {
    id: "review",
    label: "审查",
    icon: <GitPullRequest size={iconSize} />,
    shortcut: "Ctrl+Shift+R",
    enabled: true,
  },
  {
    id: "browser",
    label: "浏览器",
    icon: <Globe2 size={iconSize} />,
    shortcut: "Ctrl+Shift+B",
    enabled: true,
  },
  {
    id: "goal",
    label: "目标",
    icon: <Goal size={iconSize} />,
    enabled: true,
  },
  {
    id: "plan",
    label: "计划",
    icon: <ListChecks size={iconSize} />,
    enabled: true,
  },
  {
    id: "files",
    label: "打开文件",
    icon: <FileText size={iconSize} />,
    shortcut: "Ctrl+P",
    enabled: true,
  },
  {
    id: "sideChat",
    label: "侧边聊天",
    icon: <MessageSquarePlus size={iconSize} />,
    shortcut: "Ctrl+Alt+S",
    enabled: true,
  },
  {
    id: "terminal",
    label: "终端",
    icon: <SquareTerminal size={iconSize} />,
    shortcut: "Ctrl+`",
    enabled: true,
  },
  {
    id: "agents",
    label: "Agents",
    icon: <Bot size={iconSize} />,
    enabled: true,
  },
  {
    id: "hooks",
    label: "Hooks",
    icon: <PlugZap size={iconSize} />,
    enabled: true,
  },
  {
    id: "sessions",
    label: "恢复/分叉",
    icon: <GitFork size={iconSize} />,
    enabled: true,
  },
  {
    id: "tokenUsage",
    label: "Token",
    icon: <TimerReset size={iconSize} />,
    enabled: true,
  },
  {
    id: "collaboration",
    label: "协作",
    icon: <Handshake size={iconSize} />,
    enabled: true,
  },
  {
    id: "toolProbe",
    label: "工具探针",
    icon: <Search size={iconSize} />,
    enabled: (flags) => flags.debugMode,
  },
];

export function getRightDockTool(id: string): RightDockToolMeta | undefined {
  return rightDockTools.find((tool) => tool.id === id);
}

export function isRightDockToolEnabled(
  id: string,
  flags: RightDockFlags,
): boolean {
  const tool = getRightDockTool(id);
  if (!tool) return false;
  return typeof tool.enabled === "function"
    ? tool.enabled(flags)
    : tool.enabled;
}
