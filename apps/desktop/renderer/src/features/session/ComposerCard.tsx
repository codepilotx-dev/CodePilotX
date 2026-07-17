import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import {
  Activity,
  ArrowUp,
  Box,
  Blocks,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Compass,
  FileText,
  Folder,
  FileSpreadsheet,
  GitBranch,
  Hand,
  ListChecks,
  MessageSquare,
  Monitor,
  Palette,
  Paperclip,
  Plus,
  Presentation,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import type {
  DesktopPermissionMode,
  DesktopQueuedFollowUp,
  DesktopQueuePauseReason,
  DesktopUserMessageInput,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopThreadGoal,
  DesktopWorkspace,
  DesktopContextUsage,
  DesktopComposerAttachment,
  DesktopSlashCommandSuggestion,
  LocalRouterMode,
  ModelProviderID,
} from "../../../shared/types.js";
import type { ModelPreset } from "../../modelPresets.js";
import { ChipButton } from "../../components/ui/ChipButton.js";
import { IconButton } from "../../components/ui/IconButton.js";
import { MetaChip } from "../../components/ui/MetaChip.js";
import { SessionFollowUpDock } from "./SessionFollowUpDock.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { preventOutsideDismissWhenDebug } from "../../components/ui/debugDropdown.js";
import { buildPopoverSizingStyle } from "../../components/ui/popoverSizing.js";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover.js";
import { ChatInputDropdown } from "./ChatInputDropdown.js";
import { BranchSelectPopover } from "./BranchSelectPopover.js";
import { ComposerStatusOverlay } from "./ComposerStatusOverlay.js";

type Option<T extends string> = {
  value: T;
  label: string;
  detail?: string;
};

type ProviderModelOption = {
  providerID: ModelProviderID;
  displayName: string;
  modelPresets: ModelPreset[];
};

type ComposerDropdown =
  | "context"
  | "permission"
  | "model"
  | "project"
  | "mode"
  | "branch"
  | "status"
  | "goal";

type ContextPluginTone =
  | "docs"
  | "pdf"
  | "sheets"
  | "slides"
  | "template"
  | "browser";

type ContextPlugin = {
  name: string;
  description: string;
  tone: ContextPluginTone;
  icon: React.ReactNode;
};

type ContextAgentOption = {
  name: string;
  role: string;
  icon: string;
  tone: "red" | "amber";
};

export const CONTEXT_AGENT_OPTIONS: ContextAgentOption[] = [
  { name: "Schrodinger", role: "explorer", icon: "DNA", tone: "red" },
  { name: "Russell", role: "explorer", icon: "ATOM", tone: "amber" },
];

const INSTALLED_CONTEXT_PLUGINS: ContextPlugin[] = [
  {
    name: "Documents",
    description: "Create and edit document artifacts",
    tone: "docs",
    icon: <FileText size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: "PDF",
    description: "Read, create, and verify PDF files",
    tone: "pdf",
    icon: <FileText size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: "Spreadsheets",
    description: "Create and edit spreadsheet files",
    tone: "sheets",
    icon: (
      <FileSpreadsheet
        size={APP_ICON_SIZE}
        strokeWidth={APP_ICON_STROKE_WIDTH}
      />
    ),
  },
  {
    name: "Presentations",
    description: "Create and edit presentation files",
    tone: "slides",
    icon: (
      <Presentation size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
    ),
  },
  {
    name: "Template Creator",
    description: "Create or update personal artifact templates",
    tone: "template",
    icon: <Palette size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
  {
    name: "浏览器",
    description: "Control the in-app browser with CodePilotX",
    tone: "browser",
    icon: <Compass size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
];

type UnifiedMenuGroup =
  | "添加"
  | "子智能体"
  | "插件"
  | "Skills";

type UnifiedMenuItem = {
  group: UnifiedMenuGroup;
  key: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  /** Optional slash command name for dedup. Local entries declare ownership. */
  commandName?: string;
  /** Text for keyword filtering (label + keywords) */
  matchText: string;
  /** Whether the item is active/pressed */
  isActive?: boolean;
  /** Whether the option is visible but not wired in this desktop surface yet. */
  disabled?: boolean;
  /** Core action, without trigger-text-clearing or dropdown-closing */
  onSelect: () => void;
};

const UNIFIED_GROUP_ORDER: UnifiedMenuGroup[] = [
  "添加",
  "子智能体",
  "插件",
  "Skills",
];

const UNIFIED_GROUP_LABELS: Record<UnifiedMenuGroup, string> = {
  "添加": "添加",
  "子智能体": "子智能体",
  "插件": "插件",
  Skills: "技能",
};

const PERMISSION_CHIP_CLASS_NAMES: Record<DesktopPermissionMode, string> = {
  default: "permission-chip permission-chip-default",
  "auto-review": "permission-chip permission-chip-auto",
  "full-access": "permission-chip permission-chip-bypassPermissions",
  custom: "permission-chip permission-chip-customConfig",
};

type Props = {
  input: string;
  canSubmit: boolean;
  sessionStatus: DesktopSessionStatus;
  permissionMode: DesktopPermissionMode;
  planModeActive?: boolean;
  goalModeEnabled?: boolean;
  onGoalModeChange?: (enabled: boolean) => void;
  localRouterMode?: LocalRouterMode;
  enableParetoCodeRouter?: boolean;
  enableFusionRouter?: boolean;
  thinkingMode: DesktopThinkingMode;
  selectedProviderID: ModelProviderID;
  selectedModelPreset: string;
  modelConfigured?: boolean;
  modelCatalogLoading?: boolean;
  modelConfigurationMessage?: string;
  submitDisabledReason?: string;
  showThinkingOptions: boolean;
  deepSeekThinkingControls: boolean;
  showContextUsage: boolean;
  contextUsage: DesktopContextUsage | null;
  modelPresets: ModelPreset[];
  providerOptions: ProviderModelOption[];
  permissionOptions: Option<DesktopPermissionMode>[];
  thinkingOptions: Option<DesktopThinkingMode>[];
  branchName: string;
  branches: string[];
  recentWorkspaces: DesktopWorkspace[];
  workspace: DesktopWorkspace | null;
  attachments?: DesktopComposerAttachment[];
  slashCommands?: DesktopSlashCommandSuggestion[];
  selectedSkillToken?: DesktopSlashCommandSuggestion & { skillPath: string };
  placeholder?: string;
  onChooseWorkspace: () => void;
  onInputChange: (value: string) => void;
  onInterrupt: () => void;
  onProviderModelChange: (
    providerID: ModelProviderID,
    modelPresetID: string,
  ) => void;
  onAddFiles?: (filePaths: string[]) => void;
  onOpenFiles: () => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onCloneGithub?: () => void;
  onClearWorkspace: () => void;
  onOpenBrowser?: () => void;
  onBranchSelect: (branch: string) => void;
  onCreateBranch: () => void;
  onPermissionChange: (value: DesktopPermissionMode) => void;
  onPlanModeChange?: (active: boolean) => void;
  onLocalRouterModeChange?: (mode: LocalRouterMode) => void;
  onSubmit: () => void;
  onThinkingChange: (value: DesktopThinkingMode) => void;
  onSkillSelect?: (
    skill: DesktopSlashCommandSuggestion & { skillPath: string },
  ) => void;
  onSkillDeselect?: () => void;
  routedSessionId?: string | null;
  contextDropdownSide?: "top" | "bottom";
  debugMode?: boolean;
  queuedFollowUps?: DesktopQueuedFollowUp[];
  queuePauseReason?: DesktopQueuePauseReason | null;
  onFollowUpEdit?: (followUpId: string, input: DesktopUserMessageInput) => void;
  onFollowUpRemove?: (followUpId: string) => void;
  onFollowUpSendNow?: (followUpId: string) => void;
  onFollowUpReorder?: (followUpIds: string[]) => void;
  onFollowUpResume?: () => void;
  threadGoal?: DesktopThreadGoal | null;
  onGoalPause?: () => void;
  onGoalResume?: () => void;
  onGoalComplete?: () => void;
  onGoalClear?: () => void;
  subagentMode?: boolean;
  showBottomBar?: boolean;
};

export function ComposerCard({
  input,
  canSubmit,
  sessionStatus,
  permissionMode,
  planModeActive = false,
  goalModeEnabled = false,
  onGoalModeChange,
  localRouterMode = "off",
  enableParetoCodeRouter = false,
  enableFusionRouter = false,
  thinkingMode,
  selectedProviderID,
  selectedModelPreset,
  modelConfigured = true,
  modelCatalogLoading = false,
  modelConfigurationMessage,
  submitDisabledReason,
  showThinkingOptions,
  deepSeekThinkingControls,
  showContextUsage,
  contextUsage,
  modelPresets,
  providerOptions,
  permissionOptions,
  thinkingOptions,
  branchName,
  branches,
  recentWorkspaces,
  workspace,
  attachments = [],
  slashCommands,
  selectedSkillToken,
  placeholder = "随心输入",
  onChooseWorkspace,
  onInputChange,
  onInterrupt,
  onProviderModelChange,
  onAddFiles,
  onOpenFiles,
  onRemoveAttachment,
  onOpenWorkspace,
  onCloneGithub,
  onClearWorkspace,
  onOpenBrowser,
  onBranchSelect,
  onCreateBranch,
  onPermissionChange,
  onPlanModeChange,
  onLocalRouterModeChange,
  onSubmit,
  onThinkingChange,
  onSkillSelect,
  onSkillDeselect,
  routedSessionId,
  contextDropdownSide = "top",
  debugMode = false,
  queuedFollowUps,
  queuePauseReason,
  onFollowUpEdit,
  onFollowUpRemove,
  onFollowUpSendNow,
  onFollowUpReorder,
  onFollowUpResume,
  threadGoal,
  onGoalPause,
  onGoalResume,
  onGoalComplete,
  onGoalClear,
  subagentMode = false,
  showBottomBar = true,
}: Props): React.ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [openDropdown, setOpenDropdown] = useState<ComposerDropdown | null>(
    null,
  );
  const [branchSearch, setBranchSearch] = useState("");
  const [dismissedSlashInput, setDismissedSlashInput] = useState<string | null>(
    null,
  );
  const [isComposing, setIsComposing] = useState(false);
  const [dismissedMention, setDismissedMention] = useState<number | null>(null);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const selectedPermission = permissionOptions.find(
    (option) => option.value === permissionMode,
  );
  const composerPlaceholder = modelCatalogLoading
    ? "加载模型列表中……"
    : goalModeEnabled
      ? "粘贴你的计划或目标…"
      : planModeActive
        ? "Describe your task to generate a plan..."
        : placeholder;
  const selectedProvider = providerOptions.find(
    (provider) => provider.providerID === selectedProviderID,
  );
  const selectedModel =
    modelPresets.find((preset) => preset.id === selectedModelPreset) ??
    selectedProvider?.modelPresets.find(
      (preset) => preset.id === selectedModelPreset,
    );
  const selectedModelLabel = modelCatalogLoading
    ? "加载模型列表中……"
    : !modelConfigured
      ? "未配置模型"
      : (selectedModel?.label ?? "未选择模型");
  const selectedModelTitle = modelCatalogLoading
    ? "加载模型列表中……"
    : !modelConfigured
      ? "未配置模型"
      : (selectedModel?.label ?? "未选择模型");
  const selectedThinking = thinkingOptions.find(
    (option) => option.value === thinkingMode,
  );
  const selectedThinkingLabel = deepSeekThinkingControls
    ? thinkingMode === "disabled"
      ? "思考关闭"
      : thinkingMode === "enabled"
        ? "超高"
        : "高"
    : (selectedThinking?.label ?? "默认");

  const slashDropdownRequested =
    input.startsWith("/") && input !== dismissedSlashInput;

  const slashSearch = useMemo(() => {
    if (!input.startsWith("/")) return "";
    return input.slice(1).trimStart();
  }, [input]);

  const activeMention = useMemo(() => {
    if (isComposing) return null;
    if (dismissedMention !== null) return null;
    return getActiveComposerMention(input, selectionStart);
  }, [input, isComposing, dismissedMention, selectionStart]);

  const showSlashContextDropdown = slashDropdownRequested && !activeMention;

  const unifiedMenuItems = useMemo((): UnifiedMenuItem[] => {
    const items: UnifiedMenuItem[] = [];

    // 添加
    items.push({
      group: "添加",
      key: "add-files",
      label: "Files and folders",
      icon: <Paperclip size={14} />,
      matchText: "Files and folders 添加 add files",
      onSelect: () => {
        onOpenFiles();
      },
    });

    items.push(
      {
        group: "添加",
        key: "ide-context",
        label: "IDE 上下文",
        hint: "包含当前选择、打开的文件以及其他来自你的 IDE 的上下文",
        icon: <Blocks size={14} />,
        matchText: "IDE 上下文 ide context",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "mcp",
        label: "MCP",
        hint: "显示 MCP 服务器状态",
        icon: <Paperclip size={14} />,
        matchText: "MCP mcp servers",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "code-review",
        label: "代码审查",
        hint: "审查未暂存的更改，或与某个分支进行比较",
        icon: <ShieldCheck size={14} />,
        matchText: "代码审查 code review",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "task",
        label: "任务",
        hint: "不要在项目中工作",
        icon: <MessageSquare size={14} />,
        matchText: "任务 task",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "initialize",
        label: "初始化",
        hint: "创建包含 Codex 说明的 AGENTS.md 文件",
        icon: <FileText size={14} />,
        matchText: "初始化 initialize agents md",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "feedback",
        label: "反馈",
        hint: "发送关于此任务的反馈",
        icon: <MessageSquare size={14} />,
        matchText: "反馈 feedback",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "pet",
        label: "宠物",
        hint: "唤醒或收起桌面宠物",
        icon: <CircleUserRound size={14} />,
        matchText: "宠物 pet",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "fast",
        label: "快速",
        hint: "1.5x speed, increased usage",
        icon: <Zap size={14} />,
        matchText: "快速 fast speed",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "reasoning",
        commandName: "effort",
        label: "推理",
        hint: selectedThinkingLabel,
        icon: <Brain size={14} />,
        matchText: "推理 reasoning thinking",
        onSelect: () => setOpenDropdown("model"),
      },
      {
        group: "添加",
        key: "worktree",
        label: "新工作树",
        hint: "在新的工作树中运行此任务",
        icon: <GitBranch size={14} />,
        matchText: "新工作树 worktree",
        disabled: true,
        onSelect: () => {},
      },
      {
        group: "添加",
        key: "model",
        commandName: "model",
        label: "模型",
        hint: selectedModelLabel,
        icon: <Box size={14} />,
        matchText: "模型 model",
        onSelect: () => setOpenDropdown("model"),
      },
      {
        group: "添加",
        key: "status",
        commandName: "status",
        label: "状态",
        hint: "显示任务 ID、上下文用量和速率限制",
        icon: <Activity size={14} />,
        matchText: "状态 status task id context usage rate limit",
        onSelect: () => setOpenDropdown("status"),
      },
      {
        group: "添加",
        key: "memory",
        commandName: "remember",
        label: "记忆",
        hint: "生成 · 开",
        icon: <Brain size={14} />,
        matchText: "记忆 memory",
        disabled: true,
        onSelect: () => {},
      },
    );

    // 目标
    items.push({
      group: "添加",
      key: "goal-mode",
      commandName: "goal",
      label: "目标",
      hint: "设置 CodePilotX 将持续努力实现的目标",
      icon: <Target size={14} />,
      matchText: "目标 goal",
      isActive: goalModeEnabled,
      disabled: subagentMode,
      onSelect: () => {
        onGoalModeChange?.(!goalModeEnabled);
      },
    });

    // 计划模式
    items.push({
      group: "添加",
      key: "plan-mode",
      commandName: "plan",
      label: "计划模式",
      hint: "开启计划模式",
      icon: <ListChecks size={14} />,
      matchText: "计划模式 plan",
      isActive: planModeActive,
      disabled: subagentMode,
      onSelect: () => {
        onPlanModeChange?.(true);
      },
    });

    // 智能体
    for (const agent of CONTEXT_AGENT_OPTIONS) {
      items.push({
        group: "子智能体",
        key: `agent-${agent.name}`,
        label: agent.name,
        hint: agent.role,
        icon: (
          <span
            className="chat-input__dropdown-agent-icon"
            style={{
              color: agent.tone === "red" ? "#ef4444" : "#f59e0b",
            }}
          >
            {agent.icon === "DNA" ? "🧬" : "⚛️"}
          </span>
        ),
        matchText: `${agent.name} ${agent.role} 智能体`,
        disabled: subagentMode,
        onSelect: () => {},
      });
    }

    // 插件
    for (const plugin of INSTALLED_CONTEXT_PLUGINS) {
      const bgColor =
        plugin.tone === "docs"
          ? "#3b82f6"
          : plugin.tone === "pdf"
            ? "#ef4444"
            : plugin.tone === "sheets"
              ? "#22c55e"
              : plugin.tone === "slides"
                ? "#f59e0b"
                : plugin.tone === "template"
                  ? "#ec4899"
                  : "#06b6d4";
      items.push({
        group: "插件",
        key: `plugin-${plugin.name}`,
        label: plugin.name,
        hint: plugin.description,
        icon: (
          <span className="chat-input__dropdown-bullet" style={{ background: bgColor }} />
        ),
        matchText: `${plugin.name} ${plugin.description} 插件`,
        onSelect: () => {
          if (plugin.tone === "browser") {
            onOpenBrowser?.();
          }
        },
      });
    }

    // Skills + 命令 (from slashCommands) — skip duplicates of local entries
    // Collect command names owned by local entries + reserved names
    const ownedCommandNames = new Set<string>();
    for (const item of items) {
      if (item.commandName) ownedCommandNames.add(item.commandName);
    }
    ownedCommandNames.add("branch"); // reserved — exclude dynamic "派生"

    for (const cmd of slashCommands ?? []) {
      if (ownedCommandNames.has(cmd.name)) continue;
      if (cmd.category === "skill") {
        items.push({
          group: "Skills",
          key: `skill-${cmd.name}`,
          label: cmd.title,
          hint: cmd.description,
          icon: <Sparkles size={14} strokeWidth={1.5} />,
          matchText: `${cmd.title} ${cmd.name}`,
          disabled: subagentMode,
          onSelect: () => {
            if ("skillPath" in cmd && cmd.skillPath) {
              onSkillSelect?.(
                cmd as DesktopSlashCommandSuggestion & {
                  skillPath: string;
                },
              );
            }
          },
        });
      } else if (cmd.category === "command") {
        items.push({
          group: "添加",
          key: `cmd-${cmd.name}`,
          label: cmd.title,
          hint: cmd.description,
          icon: <Search size={14} strokeWidth={1.5} />,
          matchText: `${cmd.title} ${cmd.name}`,
          onSelect: () => {},
        });
      }
    }

    return items;
  }, [
    slashCommands,
    goalModeEnabled,
    planModeActive,
    onOpenFiles,
    onGoalModeChange,
    onPlanModeChange,
    onOpenBrowser,
    onSkillSelect,
    selectedModelLabel,
    selectedThinkingLabel,
    subagentMode,
  ]);

  const [activeMenuIndex, setActiveMenuIndex] = useState(0);
  const activeMenuKeyword = openDropdown === "context"
    ? ""
    : activeMention?.query ?? slashSearch;
  const activeMenuItems = useMemo(
    () => filterUnifiedMenuItems(unifiedMenuItems, activeMenuKeyword),
    [activeMenuKeyword, unifiedMenuItems],
  );
  const unifiedMenuOpen =
    openDropdown === "context" ||
    showSlashContextDropdown ||
    Boolean(activeMention);

  useEffect(() => {
    if (!unifiedMenuOpen) return;
    setActiveMenuIndex(firstEnabledMenuIndex(activeMenuItems));
  }, [activeMenuItems, unifiedMenuOpen]);

  useEffect(() => {
    if (input.trimStart() !== "/") {
      setDismissedSlashInput(null);
    }
  }, [input]);

  useEffect(() => {
    // Reset mention dismissal when input changes away from the @ position
    if (dismissedMention !== null) {
      const atIndex = input.lastIndexOf("@", dismissedMention);
      if (atIndex === -1 || input.slice(atIndex).includes(" ")) {
        setDismissedMention(null);
      }
    }
  }, [input, dismissedMention]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = Math.floor((window.innerHeight || 0) * 0.4);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [input]);

  function closeDropdown(): void {
    setOpenDropdown(null);
  }

  function handleUnifiedPlusSelect(item: UnifiedMenuItem): void {
    if (item.disabled) return;
    // Items that manage their own dropdown (status, model, reasoning) should
    // not be followed by closeDropdown(), otherwise React batches the two
    // setOpenDropdown calls and the sub-dropdown never opens.
    const managesOwnDropdown = item.key === "status" || item.key === "model" || item.key === "reasoning";
    item.onSelect();
    if (!managesOwnDropdown) {
      closeDropdown();
    }
  }

  function handleUnifiedSlashSelect(item: UnifiedMenuItem): void {
    if (item.disabled) return;
    // Clear slash trigger text (preserve text after the /command)
    const slashMatch = input.match(/^\/\S+/);
    if (slashMatch) {
      onInputChange(input.slice(slashMatch[0].length).trimStart());
    }
    setDismissedSlashInput(input);
    // Same logic as handleUnifiedPlusSelect: skip closeDropdown for items
    // that open a sub-dropown, otherwise React batches both setOpenDropdown
    // calls and the sub-dropdown never opens.
    const managesOwnDropdown = item.key === "status" || item.key === "model" || item.key === "reasoning";
    item.onSelect();
    if (!managesOwnDropdown) {
      closeDropdown();
    }
  }

  function handleUnifiedMentionSelect(item: UnifiedMenuItem): void {
    if (item.disabled) return;
    if (activeMention) {
      const newInput =
        input.slice(0, activeMention.start) +
        input.slice(activeMention.end);
      onInputChange(newInput);
      setDismissedMention(activeMention.start);
      setSelectionStart(activeMention.start);
    }
    item.onSelect();
    closeDropdown();
  }

  function handleFileDrop(event: React.DragEvent<HTMLDivElement>): void {
    if (!onAddFiles) return;
    const filePaths = getFilePathsFromFileList(event.dataTransfer.files);
    if (filePaths.length === 0) return;
    event.preventDefault();
    onAddFiles(filePaths);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    if (!onAddFiles) return;
    const filePaths = getFilePathsFromFileList(event.clipboardData.files);
    if (filePaths.length === 0) return;
    event.preventDefault();
    onAddFiles(filePaths);
  }

  function getPermissionIcon(value: DesktopPermissionMode): React.ReactNode {
    if (value === "default") return <Hand size={APP_ICON_SIZE} />;
    if (value === "full-access") return <ShieldAlert size={APP_ICON_SIZE} />;
    if (value === "custom") return <Wrench size={APP_ICON_SIZE} />;
    return <ShieldCheck size={APP_ICON_SIZE} />;
  }

  function getPermissionClassName(value: DesktopPermissionMode): string {
    return PERMISSION_CHIP_CLASS_NAMES[value];
  }

  const isRunning = sessionStatus === "running" || sessionStatus === "waiting";
  const contextUsedText = contextUsage
    ? `${formatCompactNumber(contextUsage.usedTokens)} / ${formatCompactNumber(
        contextUsage.contextWindow,
      )} token`
    : "暂无上下文统计";
  const promptCacheHitTokens = contextUsage?.promptCacheHitTokens ?? 0;
  const promptCacheMissTokens = contextUsage?.promptCacheMissTokens ?? 0;
  const promptCacheTotalTokens = promptCacheHitTokens + promptCacheMissTokens;
  const promptCacheHitRate =
    promptCacheTotalTokens > 0
      ? Math.round((promptCacheHitTokens / promptCacheTotalTokens) * 100)
      : 0;
  const reasoningTokens = contextUsage?.reasoningTokens ?? 0;
  const showContextUsageDetails =
    promptCacheTotalTokens > 0 || reasoningTokens > 0;
  const usedPercent = contextUsage
    ? Math.min(100, Math.max(0, contextUsage.usedPercent))
    : 0;
  function UnifiedMenuContent({
    items,
    keyword,
    onItemSelect,
    activeIndex,
    onActiveIndexChange,
  }: {
    items: UnifiedMenuItem[];
    keyword: string;
    onItemSelect: (item: UnifiedMenuItem) => void;
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
  }): React.ReactNode {
    const filtered = filterUnifiedMenuItems(items, keyword);

    // Group by group in fixed order
    const grouped = new Map<UnifiedMenuGroup, UnifiedMenuItem[]>();
    for (const item of filtered) {
      const list = grouped.get(item.group) ?? [];
      list.push(item);
      grouped.set(item.group, list);
    }

    const visibleGroups = UNIFIED_GROUP_ORDER.filter(
      (g) => (grouped.get(g)?.length ?? 0) > 0,
    );

    if (visibleGroups.length === 0) {
      return <div className="chat-input__dropdown-empty">无命令</div>;
    }

    return (
      <div
        aria-label="Composer 命令"
        className="chat-input__dropdown-items"
        id="composer-unified-menu"
        role="menu"
      >
        {visibleGroups.map((group, gi) => (
          <Fragment key={group}>
            {gi > 0 ? (
              <div className="chat-input__dropdown-separator" />
            ) : null}
            <div className="chat-input__dropdown-section-title">
              <span className="chat-input__dropdown-section-leading" />
              <span className="chat-input__dropdown-section-label">
                {UNIFIED_GROUP_LABELS[group]}
              </span>
              <span className="chat-input__dropdown-section-trailing" />
            </div>
            {(grouped.get(group) ?? []).map((item) => {
              const itemIndex = filtered.indexOf(item);
              return (
              <button
                aria-disabled={item.disabled ? true : undefined}
                aria-current={item.isActive ? "true" : undefined}
                className={[
                  "chat-input__dropdown-item",
                  item.isActive ? "is-active" : "",
                  itemIndex === activeIndex ? "is-keyboard-active" : "",
                  item.disabled ? "is-disabled" : "",
                ].join(" ")}
                id={composerMenuItemId(item.key)}
                key={item.key}
                onClick={() => {
                  if (!item.disabled) onItemSelect(item);
                }}
                onMouseEnter={() => onActiveIndexChange(itemIndex)}
                role="menuitem"
                tabIndex={itemIndex === activeIndex ? 0 : -1}
                type="button"
              >
                <span className="chat-input__dropdown-leading">
                  {item.icon}
                </span>
                <span className="chat-input__dropdown-label">
                  {item.label}
                </span>
                <span className="chat-input__dropdown-trailing">
                  {item.hint ? (
                    <span className="chat-input__dropdown-hint">
                      {item.hint}
                    </span>
                  ) : null}
                </span>
              </button>
            )})}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      className="composer tw:relative tw:flex tw:w-full tw:max-w-[48rem] tw:flex-col tw:overflow-visible tw:p-3"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={handleFileDrop}
    >
      <div className="composer-top tw:relative tw:flex tw:min-h-0 tw:flex-col tw:justify-between tw:transition-[min-height] tw:duration-[220ms]">
        {attachments.length > 0 ? (
          <div
            className="composer-attachments tw:mb-2 tw:flex tw:flex-wrap tw:items-start tw:gap-2"
            aria-label="已添加附件"
          >
            {attachments.map((attachment) => (
              <div
                className={[
                  "composer-attachment-card",
                  "tw:relative tw:inline-flex tw:size-20 tw:min-w-0 tw:items-stretch tw:overflow-visible",
                  `composer-attachment-${attachment.kind}`,
                  attachment.status,
                  attachment.status === "error" ? "error" : "",
                ].join(" ")}
                key={attachment.id}
                title={attachment.error ?? attachment.path}
              >
                <span className="composer-attachment-preview">
                  {attachment.kind === "image" && attachment.previewDataUrl ? (
                    <img
                      alt={attachment.name}
                      className="composer-attachment-thumbnail"
                      src={attachment.previewDataUrl}
                    />
                  ) : (
                    <span className="composer-attachment-file-icon">
                      <FileText size={APP_ICON_SIZE} />
                    </span>
                  )}
                </span>
                <span className="composer-attachment-body">
                  <span className="composer-attachment-name">
                    {attachment.name}
                  </span>
                  <span className="composer-attachment-meta">
                    {attachment.status === "error"
                      ? attachment.error
                      : attachmentTypeLabel(attachment)}
                  </span>
                </span>
                <button
                  aria-label={`移除 ${attachment.name}`}
                  className="composer-attachment-remove"
                  onClick={() => onRemoveAttachment?.(attachment.id)}
                  title="移除附件"
                  type="button"
                >
                  <X size={12} strokeWidth={2.25} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="composer-input tw:flex tw:min-w-0 tw:items-start">
          {selectedSkillToken ? (
            <span className="composer-skill-token">
              <Sparkles
                className="composer-skill-token-icon"
                size={14}
                strokeWidth={2}
              />
              <span className="composer-skill-token-label">
                {selectedSkillToken.title}
              </span>
            </span>
          ) : null}
          <textarea
            aria-activedescendant={
              unifiedMenuOpen && activeMenuItems[activeMenuIndex]
                ? composerMenuItemId(activeMenuItems[activeMenuIndex].key)
                : undefined
            }
            aria-controls={unifiedMenuOpen ? "composer-unified-menu" : undefined}
            aria-expanded={unifiedMenuOpen}
            aria-haspopup="menu"
            className="tw:min-h-10 tw:w-full tw:min-w-0 tw:flex-1 tw:resize-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-base tw:leading-6 tw:text-app-text tw:outline-none"
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              setSelectionStart(event.target.selectionStart);
              onInputChange(event.target.value);
            }}
            onSelect={(event) => {
              setSelectionStart(event.currentTarget.selectionStart);
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => {
              setIsComposing(false);
              setSelectionStart(textareaRef.current?.selectionStart ?? null);
            }}
            onKeyDown={(event) => {
              if (unifiedMenuOpen) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveMenuIndex((current) =>
                    nextEnabledMenuIndex(
                      activeMenuItems,
                      current,
                      event.key === "ArrowDown" ? 1 : -1,
                    ),
                  );
                  return;
                }
                if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  setActiveMenuIndex(
                    event.key === "Home"
                      ? firstEnabledMenuIndex(activeMenuItems)
                      : lastEnabledMenuIndex(activeMenuItems),
                  );
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const item = activeMenuItems[activeMenuIndex];
                  if (item && !item.disabled) {
                    if (activeMention) handleUnifiedMentionSelect(item);
                    else handleUnifiedSlashSelect(item);
                  }
                  return;
                }
              }

              // Escape: dismiss dropdowns or interrupt session
              if (event.key === "Escape") {
                if (showSlashContextDropdown) {
                  event.preventDefault();
                  setDismissedSlashInput(input);
                  return;
                }
                if (activeMention) {
                  event.preventDefault();
                  setDismissedMention(activeMention.start);
                  return;
                }
                if (
                  sessionStatus === "running" ||
                  sessionStatus === "waiting"
                ) {
                  event.preventDefault();
                  onInterrupt();
                  return;
                }
              }

              // Backspace: remove skill chip when input is empty
              if (
                event.key === "Backspace" &&
                input.length === 0 &&
                selectedSkillToken
              ) {
                event.preventDefault();
                onSkillDeselect?.();
                return;
              }

              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (canSubmit) onSubmit();
            }}
            onPaste={handlePaste}
            placeholder={selectedSkillToken ? "" : composerPlaceholder}
            rows={1}
          />
        </div>

        <ChatInputDropdown
          open={showSlashContextDropdown}
          side="bottom"
          width="100%"
          maxWidth="100%"
          disableOutsideDismiss={debugMode}
          onClose={() => {
            setDismissedSlashInput(input);
          }}
        >
          <UnifiedMenuContent
            activeIndex={activeMenuIndex}
            items={unifiedMenuItems}
            keyword={slashSearch}
            onActiveIndexChange={setActiveMenuIndex}
            onItemSelect={handleUnifiedSlashSelect}
          />
        </ChatInputDropdown>

        <ChatInputDropdown
          open={Boolean(activeMention)}
          side="bottom"
          width="100%"
          maxWidth="100%"
          disableOutsideDismiss={debugMode}
          onClose={() => {
            if (activeMention) setDismissedMention(activeMention.start);
          }}
        >
          <UnifiedMenuContent
            activeIndex={activeMenuIndex}
            items={unifiedMenuItems}
            keyword={activeMention?.query ?? ""}
            onActiveIndexChange={setActiveMenuIndex}
            onItemSelect={handleUnifiedMentionSelect}
          />
        </ChatInputDropdown>

        <div className="composer-toolbar tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:pt-2">
          <div className="toolbar-left tw:flex tw:min-w-0 tw:items-center tw:gap-1.5">
            <IconButton
              active={openDropdown === "context"}
              aria-expanded={openDropdown === "context"}
              title="添加上下文"
              onClick={() =>
                setOpenDropdown(openDropdown === "context" ? null : "context")
              }
            >
              <Plus size={APP_ICON_SIZE} />
            </IconButton>
            <Select.Root
              open={openDropdown === "permission"}
              value={permissionMode}
              onOpenChange={(open) =>
                setOpenDropdown(open ? "permission" : null)
              }
              onValueChange={(value) => {
                onPermissionChange(value as DesktopPermissionMode);
                closeDropdown();
              }}
            >
              <Select.Trigger
                aria-label="选择权限模式"
                className={[
                  "chip-button",
                  getPermissionClassName(permissionMode),
                  openDropdown === "permission" ? "active" : "",
                  "permission-select-trigger",
                ].join(" ")}
                title="选择权限模式"
              >
                {getPermissionIcon(permissionMode)}
                <span className="permission-select-trigger-label">
                  {selectedPermission?.label ?? "默认权限"}
                </span>
                <Select.Icon asChild>
                  <ChevronDown
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  align="start"
                  className="popover-surface permission-select-content"
                  collisionPadding={12}
                  position="popper"
                  side="bottom"
                  sideOffset={6}
                  style={buildPopoverSizingStyle({ width: 300 })}
                  onPointerDownOutside={(event) => {
                    preventOutsideDismissWhenDebug(debugMode, event);
                  }}
                >
                  <Select.Viewport className="permission-select-scroll-area">
                    <div className="permission-select-scroll-content">
                      {permissionOptions.map((option) => (
                        <Select.Item
                          className="permission-select-item"
                          key={option.value}
                          value={option.value}
                        >
                          <span className="permission-select-item-icon">
                            {getPermissionIcon(option.value)}
                          </span>
                          <span className="permission-select-item-body">
                            <Select.ItemText>{option.label}</Select.ItemText>
                            {option.detail ? (
                              <span className="permission-select-item-detail">
                                {option.value === "auto-review" ? (
                                  <>
                                    <span>
                                      {option.detail.replace(/了解更多.*$/, "")}
                                    </span>
                                    <span className="permission-select-item-detail-more">
                                      了解更多
                                    </span>
                                  </>
                                ) : (
                                  option.detail
                                )}
                              </span>
                            ) : null}
                          </span>
                          <Select.ItemIndicator className="permission-select-item-indicator">
                            <Check
                              size={APP_ICON_SIZE}
                              strokeWidth={APP_ICON_STROKE_WIDTH}
                            />
                          </Select.ItemIndicator>
                        </Select.Item>
                      ))}
                    </div>
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
            {goalModeEnabled ? (
              <>
                <span className="toolbar-divider" />
                <button
                  aria-pressed="true"
                  className="chip-button composer-plan-mode-chip active"
                  onClick={() => {
                    onGoalModeChange?.(false);
                  }}
                  title="目标模式"
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="composer-plan-mode-chip-icon"
                  >
                    <Target
                      className="composer-plan-mode-chip-icon-plan"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                    <X
                      className="composer-plan-mode-chip-icon-exit"
                      size={10}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </span>
                  <span>目标</span>
                </button>
              </>
            ) : null}
            {planModeActive ? (
              <>
                <span className="toolbar-divider" />
                <button
                  aria-pressed="true"
                  className="chip-button composer-plan-mode-chip active"
                  onClick={() => {
                    onPlanModeChange?.(false);
                  }}
                  title="计划模式"
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="composer-plan-mode-chip-icon"
                  >
                    <ListChecks
                      className="composer-plan-mode-chip-icon-plan"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                    <X
                      className="composer-plan-mode-chip-icon-exit"
                      size={10}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </span>
                  <span>计划</span>
                </button>
              </>
            ) : null}
            {localRouterMode !== "off" ? (
              <>
                <span className="toolbar-divider" />
                <button
                  aria-pressed="true"
                  className="chip-button composer-plan-mode-chip active"
                  onClick={() => {
                    onLocalRouterModeChange?.("off");
                  }}
                  title={
                    localRouterMode === "pareto-code"
                      ? "Pareto Code Router"
                      : "Fusion Router"
                  }
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="composer-plan-mode-chip-icon"
                  >
                    <Sparkles
                      className="composer-plan-mode-chip-icon-plan"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                    <X
                      className="composer-plan-mode-chip-icon-exit"
                      size={10}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </span>
                  <span>
                    {localRouterMode === "pareto-code" ? "Pareto" : "Fusion"}
                  </span>
                </button>
              </>
            ) : null}
          </div>

          <div className="toolbar-right tw:flex tw:min-w-0 tw:items-center tw:gap-1.5">
            {showContextUsage ? (
              <span
                aria-label={`上下文窗口使用量：${contextUsage ? `已用 ${usedPercent}%，剩余 ${100 - usedPercent}%` : "暂无数据"}`}
                className="context-usage-chip"
                tabIndex={0}
                style={
                  {
                    "--context-usage-progress": usedPercent,
                  } as React.CSSProperties
                }
              >
                <span className="chip-dot" />
                <span className="context-usage-popover" role="tooltip">
                  <span>上下文窗口：</span>
                  {contextUsage ? (
                    <>
                      <strong>
                        已用 {contextUsage.usedPercent}%，剩余{" "}
                        {contextUsage.remainingPercent}%
                      </strong>
                      <span>已使用 {contextUsedText}</span>
                      {showContextUsageDetails ? (
                        <>
                          {promptCacheTotalTokens > 0 ? (
                            <>
                              <span>缓存详情：</span>
                              <span>
                                命中缓存{" "}
                                {formatCompactNumber(promptCacheHitTokens)}{" "}
                                (命中率 {promptCacheHitRate}%)
                              </span>
                              <span>
                                未命中缓存{" "}
                                {formatCompactNumber(promptCacheMissTokens)}
                              </span>
                            </>
                          ) : null}
                          {reasoningTokens > 0 ? (
                            <span>
                              推理 token: {formatCompactNumber(reasoningTokens)}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                      <span>
                        {contextUsage.provider
                          ? `${contextUsage.provider} · `
                          : ""}
                        {contextUsage.model}
                      </span>
                    </>
                  ) : (
                    <strong>{contextUsedText}</strong>
                  )}
                </span>
              </span>
            ) : null}
            <DropdownMenu.Root
              open={openDropdown === "model"}
              onOpenChange={(open) => setOpenDropdown(open ? "model" : null)}
            >
              <DropdownMenu.Trigger asChild>
                <ChipButton
                  active={openDropdown === "model"}
                  className="subtle composer-model-chip"
                  loading={modelCatalogLoading}
                  title={`${selectedProvider?.displayName ?? "模型"} · ${selectedModelTitle}`}
                >
                  <span className="composer-model-chip-label">
                    {selectedModelLabel}
                  </span>
                  {showThinkingOptions ? (
                    <span className="composer-model-chip-thinking">
                      {selectedThinkingLabel}
                    </span>
                  ) : null}
                </ChipButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="popover-surface rm-model-menu"
                  align="end"
                  side="top"
                  sideOffset={6}
                  style={buildPopoverSizingStyle({ width: 200 })}
                  onPointerDownOutside={(event) => {
                    preventOutsideDismissWhenDebug(debugMode, event);
                  }}
                >
                  <div className="rm-model-menu-scroll-content">
                    {showThinkingOptions ? (
                      deepSeekThinkingControls ? (
                        <>
                          <div className="rm-section-header">思考模式</div>
                          <DropdownMenu.Item
                            className="rm-menu-item"
                            onSelect={() => {
                              onThinkingChange("default");
                            }}
                          >
                            <span className="rm-item-label">启用</span>
                            {thinkingMode !== "disabled" ? (
                              <Check
                                className="rm-item-check"
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            ) : null}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            className="rm-menu-item"
                            onSelect={() => {
                              onThinkingChange("disabled");
                              closeDropdown();
                            }}
                          >
                            <span className="rm-item-label">禁用</span>
                            {thinkingMode === "disabled" ? (
                              <Check
                                className="rm-item-check"
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            ) : null}
                          </DropdownMenu.Item>
                          {thinkingMode !== "disabled" ? (
                            <>
                              <div className="rm-divider" />
                              <div className="rm-section-header">推理强度</div>
                              <DropdownMenu.Item
                                className="rm-menu-item"
                                onSelect={() => {
                                  onThinkingChange("default");
                                  closeDropdown();
                                }}
                              >
                                <span className="rm-item-label">高</span>
                                {thinkingMode !== "enabled" ? (
                                  <Check
                                    className="rm-item-check"
                                    size={APP_ICON_SIZE}
                                    strokeWidth={APP_ICON_STROKE_WIDTH}
                                  />
                                ) : null}
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                className="rm-menu-item"
                                onSelect={() => {
                                  onThinkingChange("enabled");
                                  closeDropdown();
                                }}
                              >
                                <span className="rm-item-label">超高</span>
                                {thinkingMode === "enabled" ? (
                                  <Check
                                    className="rm-item-check"
                                    size={APP_ICON_SIZE}
                                    strokeWidth={APP_ICON_STROKE_WIDTH}
                                  />
                                ) : null}
                              </DropdownMenu.Item>
                            </>
                          ) : null}
                          <div className="rm-divider" />
                        </>
                      ) : (
                        <>
                          <div className="rm-section-header">推理</div>
                          {thinkingOptions.map((option) => (
                            <DropdownMenu.Item
                              className="rm-menu-item"
                              key={option.value}
                              onSelect={() => {
                                onThinkingChange(option.value);
                                closeDropdown();
                              }}
                            >
                              <span className="rm-item-label">
                                {option.label}
                              </span>
                              {option.value === thinkingMode ? (
                                <Check
                                  className="rm-item-check"
                                  size={APP_ICON_SIZE}
                                  strokeWidth={APP_ICON_STROKE_WIDTH}
                                />
                              ) : null}
                            </DropdownMenu.Item>
                          ))}
                          <div className="rm-divider" />
                        </>
                      )
                    ) : null}
                    <div className="rm-section-header">提供商</div>
                    {providerOptions.length === 0 ? (
                      <div className="rm-empty">未配置模型</div>
                    ) : null}
                    {providerOptions.map((provider) => (
                      <DropdownMenu.Sub key={provider.providerID}>
                        <DropdownMenu.SubTrigger
                          className={[
                            "rm-sub-trigger",
                            provider.providerID === selectedProviderID
                              ? "selected"
                              : "",
                          ].join(" ")}
                        >
                          <span className="rm-sub-trigger-content">
                            <span className="rm-item-label">
                              {provider.displayName}
                            </span>
                            {provider.providerID === selectedProviderID ? (
                              <Check
                                className="rm-item-check rm-provider-check"
                                size={APP_ICON_SIZE}
                                strokeWidth={APP_ICON_STROKE_WIDTH}
                              />
                            ) : null}
                          </span>
                          <ChevronRight
                            className="rm-item-arrow"
                            size={APP_ICON_SIZE}
                          />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent
                            className="popover-surface rm-model-menu rm-model-submenu"
                            alignOffset={-6}
                            sideOffset={8}
                            style={buildPopoverSizingStyle({
                              width: "auto",
                              maxWidth:
                                "min(calc(320px + var(--popover-width-extra)), calc(100vw - 32px))",
                            })}
                          >
                            <div className="rm-model-submenu-scroll-content">
                              <div className="rm-section-header">模型</div>
                              {provider.modelPresets.map((preset) => (
                                <DropdownMenu.Item
                                  className="rm-menu-item"
                                  key={preset.id}
                                  onSelect={() => {
                                    onProviderModelChange(
                                      provider.providerID,
                                      preset.id,
                                    );
                                    closeDropdown();
                                  }}
                                >
                                  <span className="rm-item-label">
                                    {preset.label}
                                  </span>
                                  {provider.providerID === selectedProviderID &&
                                  preset.id === selectedModelPreset ? (
                                    <Check
                                      className="rm-item-check"
                                      size={APP_ICON_SIZE}
                                      strokeWidth={APP_ICON_STROKE_WIDTH}
                                    />
                                  ) : null}
                                </DropdownMenu.Item>
                              ))}
                            </div>
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                    ))}
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <button
              aria-label={isRunning && !canSubmit ? "停止" : "发送"}
              className="send-button"
              disabled={!isRunning && !canSubmit}
              onClick={isRunning && !canSubmit ? onInterrupt : onSubmit}
              title={
                isRunning && !canSubmit
                  ? "停止 Esc"
                  : modelConfigured
                    ? (submitDisabledReason ?? "发送")
                    : (modelConfigurationMessage ?? "未配置模型")
              }
              type="button"
            >
              {isRunning && !canSubmit ? (
                <Square size={APP_ICON_SIZE} fill="currentColor" />
              ) : (
                <ArrowUp
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              )}
            </button>
          </div>
        </div>
        <ChatInputDropdown
          open={openDropdown === "context"}
          onClose={closeDropdown}
          disableOutsideDismiss={debugMode}
          side={contextDropdownSide}
          width="100%"
          maxWidth="100%"
        >
          <UnifiedMenuContent
            activeIndex={activeMenuIndex}
            items={unifiedMenuItems}
            keyword=""
            onActiveIndexChange={setActiveMenuIndex}
            onItemSelect={handleUnifiedPlusSelect}
          />
        </ChatInputDropdown>
        <ComposerStatusOverlay
          open={openDropdown === "status"}
          onClose={closeDropdown}
          routedSessionId={routedSessionId}
          contextUsage={contextUsage}
          selectedProviderID={selectedProviderID}
          side={contextDropdownSide}
          disableOutsideDismiss={debugMode}
        />
      </div>

      {showBottomBar ? (
        <div className="composer-bottom tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-2 tw:pt-2">
          {subagentMode ? (
            <MetaChip
              icon={<Folder size={APP_ICON_SIZE} />}
              label={workspace?.name ?? "项目"}
              title="子 Agent 工作区固定"
            />
          ) : (
            <ProjectSwitcherPopover
              side="top"
              open={openDropdown === "project"}
              width={200}
              onOpenChange={(open) => setOpenDropdown(open ? "project" : null)}
              disableOutsideDismiss={debugMode}
              recentWorkspaces={recentWorkspaces}
              workspace={workspace}
              onOpenWorkspace={onOpenWorkspace}
              onChooseWorkspace={() => {
                onChooseWorkspace();
                closeDropdown();
              }}
              onCloneGithub={() => {
                onCloneGithub?.();
                closeDropdown();
              }}
              onClearWorkspace={() => {
                onClearWorkspace();
                closeDropdown();
              }}
              trigger={
                <MetaChip
                  active={openDropdown === "project"}
                  icon={<Folder size={APP_ICON_SIZE} />}
                  label={workspace?.name ?? "进入项目工作"}
                  title="选择项目"
                />
              }
            />
          )}

          {workspace ? (
            <>
              <PopoverMenu
                className="popover-mode"
                disableOutsideDismiss={debugMode}
                open={openDropdown === "mode"}
                side="top"
                width={200}
                onOpenChange={(open) => setOpenDropdown(open ? "mode" : null)}
                trigger={
                  <MetaChip
                    active={openDropdown === "mode"}
                    icon={<Monitor size={APP_ICON_SIZE} />}
                    label="本地模式"
                    title="启动模式"
                  />
                }
              >
                <div className="popover-header">启动模式</div>
                <div className="popover-section">
                  <PopoverItem
                    icon={<Monitor size={APP_ICON_SIZE} />}
                    selected
                    withCheck
                  >
                    本地模式
                  </PopoverItem>
                  <PopoverItem icon={<GitBranch size={APP_ICON_SIZE} />} disabled>
                    新工作树
                  </PopoverItem>
                  <PopoverItem icon={<Search size={APP_ICON_SIZE} />} disabled>
                    关联 CodePilotX Web
                  </PopoverItem>
                </div>
              </PopoverMenu>

              {threadGoal ? (
                <PopoverMenu
                  className="popover-goal"
                  disableOutsideDismiss={debugMode}
                  open={openDropdown === "goal"}
                  side="top"
                  width={200}
                  onOpenChange={(open) => setOpenDropdown(open ? "goal" : null)}
                  trigger={
                    <MetaChip
                      active={openDropdown === "goal"}
                      icon={<Target size={APP_ICON_SIZE} />}
                      label={
                        threadGoal.status === "active"
                          ? "目标运行中"
                          : threadGoal.status === "paused"
                            ? "目标已暂停"
                            : threadGoal.status === "complete"
                              ? "目标已完成"
                              : "目标"
                      }
                      title={threadGoal.objective}
                    />
                  }
                >
                  <div className="popover-header">目标</div>
                  <div className="popover-section">
                    <div className="popover-item-text">{threadGoal.objective}</div>
                    <div className="popover-item-meta">
                      已用 Tokens: {threadGoal.tokensUsed}
                      {threadGoal.timeUsedSeconds > 0
                        ? ` | 用时: ${Math.round(threadGoal.timeUsedSeconds / 60)}分`
                        : ""}
                    </div>
                  </div>
                  <div className="popover-section">
                    {threadGoal.status === "active" ? (
                      <PopoverItem
                        icon={<Target size={APP_ICON_SIZE} />}
                        onClick={() => {
                          closeDropdown()
                          onGoalPause?.()
                        }}
                      >
                        暂停
                      </PopoverItem>
                    ) : null}
                    {threadGoal.status === "paused" ? (
                      <PopoverItem
                        icon={<Target size={APP_ICON_SIZE} />}
                        onClick={() => {
                          closeDropdown()
                          onGoalResume?.()
                        }}
                      >
                        继续
                      </PopoverItem>
                    ) : null}
                    {threadGoal.status !== "complete" ? (
                      <PopoverItem
                        icon={<Check size={APP_ICON_SIZE} />}
                        onClick={() => {
                          closeDropdown()
                          onGoalComplete?.()
                        }}
                      >
                        标记完成
                      </PopoverItem>
                    ) : null}
                    <PopoverItem
                      icon={<X size={APP_ICON_SIZE} />}
                      onClick={() => {
                        closeDropdown()
                        onGoalClear?.()
                      }}
                    >
                      清除目标
                    </PopoverItem>
                  </div>
                </PopoverMenu>
              ) : null}

              <BranchSelectPopover
                align="end"
                branchSearch={branchSearch}
                branches={branches}
                className="popover-branch"
                currentBranchName={branchName}
                disableOutsideDismiss={debugMode}
                open={openDropdown === "branch"}
                side="top"
                width={200}
                onBranchSearchChange={setBranchSearch}
                onBranchSelect={onBranchSelect}
                onCreateBranch={onCreateBranch}
                onOpenChange={(open) => setOpenDropdown(open ? "branch" : null)}
                trigger={
                  <MetaChip
                    active={openDropdown === "branch"}
                    icon={<GitBranch size={APP_ICON_SIZE} />}
                    label={branchName}
                    title="选择分支"
                  />
                }
              />
            </>
          ) : null}
        </div>
      ) : null}

      <SessionFollowUpDock
        items={queuedFollowUps ?? []}
        pauseReason={queuePauseReason}
        onEdit={onFollowUpEdit ?? (() => {})}
        onRemove={onFollowUpRemove ?? (() => {})}
        onSendNow={onFollowUpSendNow ?? (() => {})}
        onReorder={onFollowUpReorder ?? (() => {})}
        onResume={onFollowUpResume ?? (() => {})}
      />
    </div>
  );
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${trimNumber(value / 1_000)}k`;
  }
  return String(value);
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function attachmentTypeLabel(attachment: DesktopComposerAttachment): string {
  const extension = attachment.name.split(".").pop();
  if (extension && extension !== attachment.name)
    return extension.toUpperCase();
  switch (attachment.kind) {
    case "image":
      return "IMAGE";
    case "document":
      return "DOCUMENT";
    case "text":
      return "TEXT";
    case "audio":
      return "AUDIO";
    case "video":
      return "VIDEO";
    default:
      return "FILE";
  }
}

function getFilePathsFromFileList(files: FileList): string[] {
  return Array.from(files)
    .map((file) => (file as File & { path?: string }).path)
    .filter(
      (path): path is string => typeof path === "string" && path.length > 0,
    );
}

function filterUnifiedMenuItems(
  items: UnifiedMenuItem[],
  keyword: string,
): UnifiedMenuItem[] {
  const normalized = keyword.toLowerCase().trim();
  return normalized
    ? items.filter((item) => item.matchText.toLowerCase().includes(normalized))
    : items;
}

function firstEnabledMenuIndex(items: UnifiedMenuItem[]): number {
  return items.findIndex((item) => !item.disabled);
}

function lastEnabledMenuIndex(items: UnifiedMenuItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

function nextEnabledMenuIndex(
  items: UnifiedMenuItem[],
  current: number,
  direction: 1 | -1,
): number {
  if (items.length === 0) return -1;
  let index = current;
  for (let attempts = 0; attempts < items.length; attempts += 1) {
    index = (index + direction + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

function composerMenuItemId(key: string): string {
  return `composer-menu-item-${encodeURIComponent(key)}`;
}

/**
 * Detects an active @mention query before the text cursor.
 * Returns the range and query text, or null if no active mention.
 *
 * Rules:
 * - `@` must be at line start or preceded by whitespace
 * - Query is the continuous text after `@` up to the cursor
 * - Returns null when cursor is not at the end of the mention text
 */
export function getActiveComposerMention(
  input: string,
  selectionStart: number | null,
): { start: number; end: number; query: string } | null {
  if (selectionStart == null || selectionStart <= 0) return null;
  const textBefore = input.slice(0, selectionStart);
  const atIndex = textBefore.lastIndexOf("@");
  if (atIndex === -1) return null;
  if (atIndex > 0 && input[atIndex - 1] !== " ") return null;
  const query = textBefore.slice(atIndex + 1);
  if (query.includes(" ")) return null;
  // Cursor must be at end of query — no valid mention chars immediately after
  const charAfterCursor = input[selectionStart];
  if (charAfterCursor && /[a-zA-Z0-9\u4e00-\u9fff-]/.test(charAfterCursor)) {
    return null;
  }
  return { start: atIndex, end: selectionStart, query };
}
