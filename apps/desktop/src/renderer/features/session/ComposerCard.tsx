import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import {
  ArrowUp,
  Blocks,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Folder,
  FileSpreadsheet,
  GitBranch,
  Hand,
  ListChecks,
  Mic,
  Monitor,
  Palette,
  Paperclip,
  Plus,
  Presentation,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  Target,
  Wrench,
  X,
} from "lucide-react";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import type {
  DesktopPermissionMode,
  DesktopSessionStatus,
  DesktopThinkingMode,
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
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { preventOutsideDismissWhenDebug } from "../../components/ui/debugDropdown.js";
import { buildPopoverSizingStyle } from "../../components/ui/popoverSizing.js";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover.js";
import { ChatInputDropdown } from "./ChatInputDropdown.js";
import { BranchSelectPopover } from "./BranchSelectPopover.js";

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
  | "branch";

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
  | "目标"
  | "计划模式"
  | "智能体"
  | "插件"
  | "Skills"
  | "命令";

type UnifiedMenuItem = {
  group: UnifiedMenuGroup;
  key: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  /** Text for keyword filtering (label + keywords) */
  matchText: string;
  /** Whether the item is active/pressed */
  isActive?: boolean;
  /** Core action, without trigger-text-clearing or dropdown-closing */
  onSelect: () => void;
};

const UNIFIED_GROUP_ORDER: UnifiedMenuGroup[] = [
  "添加",
  "目标",
  "计划模式",
  "智能体",
  "插件",
  "Skills",
  "命令",
];

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
  contextDropdownSide?: "top" | "bottom";
  debugMode?: boolean;
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
  contextDropdownSide = "top",
  debugMode = false,
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

  const showSlashContextDropdown =
    input.startsWith("/") && input !== dismissedSlashInput;

  const slashSearch = useMemo(() => {
    if (!input.startsWith("/")) return "";
    return input.slice(1).trimStart();
  }, [input]);

  const activeMention = useMemo(() => {
    if (isComposing) return null;
    if (dismissedMention !== null) return null;
    const sel = selectionStart;
    if (sel == null || sel <= 0) return null;
    const textBefore = input.slice(0, sel);
    const atIndex = textBefore.lastIndexOf("@");
    if (atIndex === -1) return null;
    if (atIndex > 0 && input[atIndex - 1] !== " ") return null;
    const query = textBefore.slice(atIndex + 1);
    if (query.includes(" ")) return null;
    return { start: atIndex, end: sel, query };
  }, [input, isComposing, dismissedMention, selectionStart]);

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

    // 目标
    items.push({
      group: "目标",
      key: "goal-mode",
      label: "目标",
      hint: "设置 CodePilotX 将持续努力实现的目标",
      icon: <Target size={14} />,
      matchText: "目标 goal",
      isActive: goalModeEnabled,
      onSelect: () => {
        onGoalModeChange?.(!goalModeEnabled);
      },
    });

    // 计划模式
    items.push({
      group: "计划模式",
      key: "plan-mode",
      label: "计划模式",
      hint: "开启计划模式",
      icon: <ListChecks size={14} />,
      matchText: "计划模式 plan",
      isActive: planModeActive,
      onSelect: () => {
        onPlanModeChange?.(true);
      },
    });

    // 智能体
    for (const agent of CONTEXT_AGENT_OPTIONS) {
      items.push({
        group: "智能体",
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

    // Skills + 命令 (from slashCommands)
    const planGoalNames = new Set(["plan", "goal"]);
    for (const cmd of slashCommands ?? []) {
      if (cmd.category === "skill") {
        items.push({
          group: "Skills",
          key: `skill-${cmd.name}`,
          label: cmd.title,
          hint: cmd.description,
          icon: <Sparkles size={14} strokeWidth={1.5} />,
          matchText: `${cmd.title} ${cmd.name}`,
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
      } else if (cmd.category === "command" && !planGoalNames.has(cmd.name)) {
        items.push({
          group: "命令",
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
  ]);

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
    item.onSelect();
    closeDropdown();
  }

  function handleUnifiedSlashSelect(item: UnifiedMenuItem): void {
    // Clear slash trigger text (preserve text after the /command)
    const slashMatch = input.match(/^\/\S+/);
    if (slashMatch) {
      onInputChange(input.slice(slashMatch[0].length).trimStart());
    }
    setDismissedSlashInput(input);
    item.onSelect();
    closeDropdown();
  }

  function handleUnifiedMentionSelect(item: UnifiedMenuItem): void {
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
  const showFullAccessWarning = permissionMode === "full-access";
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
  }: {
    items: UnifiedMenuItem[];
    keyword: string;
    onItemSelect: (item: UnifiedMenuItem) => void;
  }): React.ReactNode {
    const kw = keyword.toLowerCase().trim();
    const filtered = kw
      ? items.filter((item) => item.matchText.toLowerCase().includes(kw))
      : items;

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
      <div className="chat-input__dropdown-items">
        {visibleGroups.map((group, gi) => (
          <Fragment key={group}>
            {gi > 0 ? (
              <div className="chat-input__dropdown-separator" />
            ) : null}
            <div className="chat-input__dropdown-section-title">{group}</div>
            {(grouped.get(group) ?? []).map((item) => (
              <div
                aria-pressed={
                  item.isActive && item.group === "目标"
                    ? true
                    : item.isActive && item.group === "计划模式"
                      ? true
                      : undefined
                }
                className={[
                  "chat-input__dropdown-item",
                  item.isActive ? "is-active" : "",
                ].join(" ")}
                key={item.key}
                onClick={() => onItemSelect(item)}
              >
                <span className="chat-input__dropdown-leading">
                  {item.icon}
                </span>
                <span className="chat-input__dropdown-label">
                  {item.label}
                </span>
                {item.hint ? (
                  <span className="chat-input__dropdown-hint">
                    {item.hint}
                  </span>
                ) : null}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      className="composer"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={handleFileDrop}
    >
      {showFullAccessWarning ? (
        <div className="permission-warning-banner">
          <ShieldOff size={APP_ICON_SIZE} />
          <span>完全访问权限 · 此对话允许直接读写文件和运行命令</span>
        </div>
      ) : null}
      <div className="composer-top">
        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label="已添加附件">
            {attachments.map((attachment) => (
              <div
                className={[
                  "composer-attachment-card",
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
        <div className="composer-input">
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

              // Prevent Enter during slash dropdown
              if (showSlashContextDropdown) {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  return;
                }
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
            items={unifiedMenuItems}
            keyword={slashSearch}
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
            items={unifiedMenuItems}
            keyword={activeMention?.query ?? ""}
            onItemSelect={handleUnifiedMentionSelect}
          />
        </ChatInputDropdown>

        <div className="composer-toolbar">
          <div className="toolbar-left">
            <IconButton
              className={[
                "icon-button",
                openDropdown === "context" ? "active" : "",
              ].join(" ")}
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

          <div className="toolbar-right">
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

            <IconButton
              className="icon-button composer-mic-button"
              title="语音输入"
            >
              <Mic size={APP_ICON_SIZE} />
            </IconButton>
            <button
              aria-label={isRunning ? "停止" : "发送"}
              className="send-button"
              disabled={!isRunning && !canSubmit}
              onClick={isRunning ? onInterrupt : onSubmit}
              title={
                isRunning
                  ? "停止 Esc"
                  : modelConfigured
                    ? (submitDisabledReason ?? "发送")
                    : (modelConfigurationMessage ?? "未配置模型")
              }
              type="button"
            >
              {isRunning ? (
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
            items={unifiedMenuItems}
            keyword=""
            onItemSelect={handleUnifiedPlusSelect}
          />
        </ChatInputDropdown>
      </div>

      <div className="composer-bottom">
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

            <BranchSelectPopover
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
