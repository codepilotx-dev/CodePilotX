import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import { Theme, DropdownMenu as RTDropdownMenu } from "@radix-ui/themes";
import {
  ArrowUp,
  Blocks,
  Box,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Compass,
  FileText,
  Folder,
  FileSpreadsheet,
  GitBranch,
  GitFork,
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
  ModelProviderID,
} from "../../../shared/types.js";
import type { ModelPreset } from "../../modelPresets.js";
import { CUSTOM_MODEL_PRESET_ID } from "../../modelPresets.js";
import { ChipButton } from "../../components/ui/ChipButton.js";
import { IconButton } from "../../components/ui/IconButton.js";
import { MetaChip } from "../../components/ui/MetaChip.js";
import { PopoverItem } from "../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../components/ui/PopoverMenu.js";
import { SearchInput } from "../../components/ui/SearchInput.js";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover.js";
import { ChatInputDropdown } from "./ChatInputDropdown.js";
import { useDesktopTheme } from "../theme/themeContext.js";

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
    description: "Control the in-app browser with Codex",
    tone: "browser",
    icon: <Compass size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
  },
];

const PERMISSION_CHIP_CLASS_NAMES: Record<DesktopPermissionMode, string> = {
  auto: "permission-chip permission-chip-auto",
  bypassPermissions: "permission-chip permission-chip-bypassPermissions",
  customConfig: "permission-chip permission-chip-customConfig",
  default: "permission-chip permission-chip-default",
  plan: "permission-chip permission-chip-plan",
};

type Props = {
  input: string;
  canSubmit: boolean;
  sessionStatus: DesktopSessionStatus;
  permissionMode: DesktopPermissionMode;
  thinkingMode: DesktopThinkingMode;
  selectedProviderID: ModelProviderID;
  selectedModelPreset: string;
  modelConfigured?: boolean;
  modelConfigurationMessage?: string;
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
  onPlanModeToggle?: (
    enabled: boolean,
    previousMode: DesktopPermissionMode,
  ) => void;
  previousNonPlanMode?: DesktopPermissionMode;
  onSubmit: () => void;
  onThinkingChange: (value: DesktopThinkingMode) => void;
  contextDropdownSide?: "top" | "bottom";
};

export function ComposerCard({
  input,
  canSubmit,
  sessionStatus,
  permissionMode,
  thinkingMode,
  selectedProviderID,
  selectedModelPreset,
  modelConfigured = true,
  modelConfigurationMessage,
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
  slashCommands = [],
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
  onPlanModeToggle,
  previousNonPlanMode,
  onSubmit,
  onThinkingChange,
  contextDropdownSide = "top",
}: Props): React.ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [openDropdown, setOpenDropdown] = useState<ComposerDropdown | null>(
    null,
  );
  const [branchSearch, setBranchSearch] = useState("");
  const { resolvedVariant } = useDesktopTheme();
  const planModeEnabled = permissionMode === "plan";
  const displayPermissionMode: DesktopPermissionMode = planModeEnabled
    ? (previousNonPlanMode ?? "default")
    : permissionMode;
  const [goalModeEnabled, setGoalModeEnabled] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [dismissedSlashInput, setDismissedSlashInput] = useState<string | null>(
    null,
  );

  const selectedPermission = permissionOptions.find(
    (option) => option.value === displayPermissionMode,
  );
  const selectedModel = modelPresets.find(
    (preset) => preset.id === selectedModelPreset,
  );
  const selectedProvider = providerOptions.find(
    (provider) => provider.providerID === selectedProviderID,
  );
  const selectedModelLabel = !modelConfigured
    ? "未配置模型"
    : selectedModelPreset === CUSTOM_MODEL_PRESET_ID
      ? "自定义模型"
      : (selectedModel?.shortLabel ??
        selectedModel?.label ??
        selectedModelPreset);
  const selectedModelTitle = !modelConfigured
    ? "未配置模型"
    : selectedModelPreset === CUSTOM_MODEL_PRESET_ID
      ? "自定义模型"
      : (selectedModel?.label ?? selectedModelPreset);
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

  const filteredBranches = useMemo(() => {
    const availableBranches =
      branches.length > 0 ||
      branchName === "无项目" ||
      branchName === "未检测到 Git 分支"
        ? branches
        : [branchName];
    const keyword = branchSearch.trim().toLowerCase();
    if (!keyword) return availableBranches;
    return availableBranches.filter((branch) =>
      branch.toLowerCase().includes(keyword),
    );
  }, [branchName, branchSearch, branches]);

  const slashInput = input.trimStart();
  const slashQuery =
    slashInput.startsWith("/") && !/\s/.test(slashInput.slice(1))
      ? slashInput.slice(1).toLowerCase()
      : null;
  const visibleSlashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    return slashCommands.filter((command) => {
      if (!slashQuery) return true;
      return (
        command.name.toLowerCase().includes(slashQuery) ||
        command.title.toLowerCase().includes(slashQuery) ||
        command.description.toLowerCase().includes(slashQuery)
      );
    });
  }, [slashCommands, slashQuery]);
  const showSlashPalette =
    slashQuery !== null &&
    input !== dismissedSlashInput &&
    visibleSlashCommands.length > 0;

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery, visibleSlashCommands.length]);

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

  function selectSlashCommand(command: DesktopSlashCommandSuggestion): void {
    onInputChange(`/${command.name} `);
    setDismissedSlashInput(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
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
    if (value === "bypassPermissions")
      return <ShieldAlert size={APP_ICON_SIZE} />;
    if (value === "customConfig") return <Wrench size={APP_ICON_SIZE} />;
    if (value === "plan") return <ListChecks size={APP_ICON_SIZE} />;
    return <ShieldCheck size={APP_ICON_SIZE} />;
  }

  function getPermissionClassName(value: DesktopPermissionMode): string {
    return PERMISSION_CHIP_CLASS_NAMES[value];
  }

  const isRunning = sessionStatus === "running" || sessionStatus === "waiting";
  const showFullAccessWarning = permissionMode === "bypassPermissions";
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
                  attachment.status === "error" ? "error" : "",
                ].join(" ")}
                key={attachment.id}
                title={attachment.error ?? attachment.path}
              >
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
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (showSlashPalette) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSlashSelectedIndex((index) =>
                    Math.min(index + 1, visibleSlashCommands.length - 1),
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSlashSelectedIndex((index) => Math.max(index - 1, 0));
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDismissedSlashInput(input);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const command = visibleSlashCommands[slashSelectedIndex];
                  if (command) selectSlashCommand(command);
                  return;
                }
              }
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (canSubmit) onSubmit();
            }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
          />
        </div>

        {showSlashPalette ? (
          <SlashCommandPalette
            commands={visibleSlashCommands}
            selectedIndex={slashSelectedIndex}
            onHover={setSlashSelectedIndex}
            onSelect={selectSlashCommand}
          />
        ) : null}

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
              value={displayPermissionMode}
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
                  getPermissionClassName(displayPermissionMode),
                  openDropdown === "permission" ? "active" : "",
                  "permission-select-trigger",
                ].join(" ")}
                title="选择权限模式"
              >
                {getPermissionIcon(displayPermissionMode)}
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
                  className="permission-select-content"
                  collisionPadding={12}
                  position="popper"
                  side="bottom"
                  sideOffset={6}
                >
                  <Select.Viewport className="permission-select-viewport">
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
                              {option.value === "auto" ? (
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
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
            {planModeEnabled ? (
              <>
                <span className="toolbar-divider" aria-hidden="true" />
                <span className="plan-mode-chip" aria-label="计划模式已开启">
                  <ListChecks
                    size={APP_ICON_SIZE}
                    className="plan-mode-chip__icon-default"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="plan-mode-chip__exit"
                    aria-label="退出计划模式"
                    title="退出计划模式"
                    onClick={() =>
                      onPermissionChange(previousNonPlanMode ?? "default")
                    }
                  >
                    <X size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  </button>
                  <span className="plan-mode-chip__label">计划</span>
                </span>
              </>
            ) : null}
          </div>

          <div className="toolbar-right">
            {showContextUsage ? (
              <span
                aria-label="上下文窗口使用量"
                className="context-usage-chip"
                tabIndex={0}
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
            <Theme appearance={resolvedVariant}>
              <RTDropdownMenu.Root
                open={openDropdown === "model"}
                onOpenChange={(open) => setOpenDropdown(open ? "model" : null)}
              >
                <RTDropdownMenu.Trigger>
                  <ChipButton
                    active={openDropdown === "model"}
                    className="subtle"
                    title={`${selectedProvider?.displayName ?? "模型"} · ${selectedModelTitle}`}
                  >
                    <span>{selectedModelLabel}</span>
                  </ChipButton>
                </RTDropdownMenu.Trigger>
                <RTDropdownMenu.Content
                  className="rm-model-menu"
                  align="end"
                  side="top"
                  sideOffset={6}
                >
                  {showThinkingOptions ? (
                    deepSeekThinkingControls ? (
                      <>
                        <div className="rm-section-header">思考模式</div>
                        <RTDropdownMenu.Item
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
                        </RTDropdownMenu.Item>
                        <RTDropdownMenu.Item
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
                        </RTDropdownMenu.Item>
                        {thinkingMode !== "disabled" ? (
                          <>
                            <div className="rm-divider" />
                            <div className="rm-section-header">推理强度</div>
                            <RTDropdownMenu.Item
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
                            </RTDropdownMenu.Item>
                            <RTDropdownMenu.Item
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
                            </RTDropdownMenu.Item>
                          </>
                        ) : null}
                        <div className="rm-divider" />
                      </>
                    ) : (
                      <>
                        <div className="rm-section-header">推理</div>
                        {thinkingOptions.map((option) => (
                          <RTDropdownMenu.Item
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
                          </RTDropdownMenu.Item>
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
                    <RTDropdownMenu.Sub key={provider.providerID}>
                      <RTDropdownMenu.SubTrigger
                        className={
                          provider.providerID === selectedProviderID
                            ? "selected"
                            : ""
                        }
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
                      </RTDropdownMenu.SubTrigger>
                      <RTDropdownMenu.SubContent
                        className="rm-model-menu"
                        alignOffset={-6}
                        sideOffset={8}
                      >
                        <div className="rm-section-header">模型</div>
                        {provider.modelPresets.map((preset) => (
                          <RTDropdownMenu.Item
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
                          </RTDropdownMenu.Item>
                        ))}
                        <RTDropdownMenu.Item
                          onSelect={() => {
                            onProviderModelChange(
                              provider.providerID,
                              CUSTOM_MODEL_PRESET_ID,
                            );
                            closeDropdown();
                          }}
                        >
                          <span className="rm-item-label">自定义模型</span>
                          {provider.providerID === selectedProviderID &&
                          selectedModelPreset === CUSTOM_MODEL_PRESET_ID ? (
                            <Check
                              className="rm-item-check"
                              size={APP_ICON_SIZE}
                              strokeWidth={APP_ICON_STROKE_WIDTH}
                            />
                          ) : null}
                        </RTDropdownMenu.Item>
                      </RTDropdownMenu.SubContent>
                    </RTDropdownMenu.Sub>
                  ))}
                </RTDropdownMenu.Content>
              </RTDropdownMenu.Root>
            </Theme>

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
                  ? "停止"
                  : modelConfigured
                    ? "发送"
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
          side={contextDropdownSide}
        >
          <div
            className="chat-input__dropdown-item"
            onClick={() => {
              onOpenFiles();
              closeDropdown();
            }}
          >
            <span className="chat-input__dropdown-leading">
              <Paperclip size={14} />
            </span>
            <span className="chat-input__dropdown-label">
              Files and folders
            </span>
          </div>
          <div className="chat-input__dropdown-item" onClick={closeDropdown}>
            <span className="chat-input__dropdown-leading">
              <Target size={14} />
            </span>
            <span className="chat-input__dropdown-label">目标</span>
            <span className="chat-input__dropdown-hint">
              设置 CodePilotX 将持续努力实现的目标
            </span>
          </div>
          <div
            className="chat-input__dropdown-item"
            onClick={() => {
              if (onPlanModeToggle) {
                onPlanModeToggle(!planModeEnabled, permissionMode);
              } else {
                onPermissionChange(planModeEnabled ? "default" : "plan");
              }
            }}
          >
            <span className="chat-input__dropdown-leading">
              <ListChecks size={14} />
            </span>
            <span className="chat-input__dropdown-label">计划模式</span>
            <span className="chat-input__dropdown-hint">
              {planModeEnabled ? "已开启" : "开启计划模式"}
            </span>
            {planModeEnabled ? (
              <svg
                className="chat-input__dropdown-check"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 7l3 3 5-6" />
              </svg>
            ) : null}
          </div>

          <div className="chat-input__dropdown-separator" />

          <div className="chat-input__dropdown-section-title">智能体</div>

          {CONTEXT_AGENT_OPTIONS.map((agent) => (
            <div
              className="chat-input__dropdown-item"
              key={agent.name}
              onClick={closeDropdown}
            >
              <span
                className="chat-input__dropdown-agent-icon"
                style={{
                  color: agent.tone === "red" ? "#ef4444" : "#f59e0b",
                }}
              >
                {agent.icon === "DNA" ? "🧬" : "⚛️"}
              </span>
              <span className="chat-input__dropdown-label">{agent.name}</span>
              <span className="chat-input__dropdown-hint">{agent.role}</span>
            </div>
          ))}

          <div className="chat-input__dropdown-separator" />

          <div className="chat-input__dropdown-section-title">插件</div>

          {INSTALLED_CONTEXT_PLUGINS.map((plugin) => (
            <div
              className="chat-input__dropdown-item"
              key={plugin.name}
              onClick={() => {
                if (plugin.tone === "browser") {
                  onOpenBrowser?.();
                }
                closeDropdown();
              }}
            >
              <span
                className={["chat-input__dropdown-bullet"].join(" ")}
                style={{
                  background:
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
                              : "#06b6d4",
                }}
              />
              <span className="chat-input__dropdown-label">{plugin.name}</span>
              <span className="chat-input__dropdown-hint">
                {plugin.description}
              </span>
            </div>
          ))}
        </ChatInputDropdown>
      </div>

      <div className="composer-bottom">
        <ProjectSwitcherPopover
          side="top"
          open={openDropdown === "project"}
          onOpenChange={(open) => setOpenDropdown(open ? "project" : null)}
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
              open={openDropdown === "mode"}
              side="top"
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

            <PopoverMenu
              className="popover-branch"
              open={openDropdown === "branch"}
              side="top"
              onOpenChange={(open) => setOpenDropdown(open ? "branch" : null)}
              trigger={
                <MetaChip
                  active={openDropdown === "branch"}
                  icon={<GitBranch size={APP_ICON_SIZE} />}
                  label={branchName}
                  title="选择分支"
                />
              }
            >
              <SearchInput
                value={branchSearch}
                onChange={setBranchSearch}
                placeholder="搜索分支"
              />
              <div className="popover-section">
                <div className="popover-section-title">分支</div>
                {filteredBranches.length === 0 ? (
                  <div className="popover-empty">无匹配分支</div>
                ) : (
                  filteredBranches.map((branch) => (
                    <PopoverItem
                      icon={<GitBranch size={APP_ICON_SIZE} />}
                      key={branch}
                      selected={branch === branchName}
                      withCheck={branch === branchName}
                      onClick={() => {
                        onBranchSelect(branch);
                        closeDropdown();
                      }}
                    >
                      {branch}
                    </PopoverItem>
                  ))
                )}
              </div>
              <div className="popover-divider" />
              <PopoverItem
                icon={<Plus size={APP_ICON_SIZE} />}
                onClick={() => {
                  onCreateBranch();
                  closeDropdown();
                }}
              >
                创建并检出新分支...
              </PopoverItem>
            </PopoverMenu>
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

function getSlashCommandIcon(
  command: DesktopSlashCommandSuggestion,
): React.ReactNode {
  switch (command.name) {
    case "effort":
      return <Brain size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />;
    case "model":
      return <Box size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />;
    case "branch":
      return (
        <GitFork size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      );
    case "status":
      return (
        <CircleGauge size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      );
    case "plan":
      return (
        <ListChecks size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      );
    case "remember":
    case "goal":
      return <Brain size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />;
    default:
      return (
        <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      );
  }
}

function SlashCommandPalette({
  commands,
  selectedIndex,
  onHover,
  onSelect,
}: {
  commands: DesktopSlashCommandSuggestion[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: DesktopSlashCommandSuggestion) => void;
}): React.ReactNode {
  const commandItems = commands.filter(
    (command) => command.category === "command",
  );
  const skillItems = commands.filter((command) => command.category === "skill");
  const skillOffset = commandItems.length;

  return (
    <div className="slash-command-palette" role="listbox">
      {commandItems.length > 0 ? (
        <SlashCommandSection
          commands={commandItems}
          offset={0}
          selectedIndex={selectedIndex}
          title={null}
          onHover={onHover}
          onSelect={onSelect}
        />
      ) : null}
      {skillItems.length > 0 ? (
        <SlashCommandSection
          commands={skillItems}
          offset={skillOffset}
          selectedIndex={selectedIndex}
          title="技能"
          onHover={onHover}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

function SlashCommandSection({
  commands,
  offset,
  selectedIndex,
  title,
  onHover,
  onSelect,
}: {
  commands: DesktopSlashCommandSuggestion[];
  offset: number;
  selectedIndex: number;
  title: string | null;
  onHover: (index: number) => void;
  onSelect: (command: DesktopSlashCommandSuggestion) => void;
}): React.ReactNode {
  return (
    <div className="slash-command-section">
      {title ? (
        <div className="slash-command-section-title">{title}</div>
      ) : null}
      {commands.map((command, index) => {
        const absoluteIndex = offset + index;
        const selected = absoluteIndex === selectedIndex;
        return (
          <button
            aria-selected={selected}
            className={[
              "slash-command-item",
              selected ? "is-selected" : "",
            ].join(" ")}
            key={command.name}
            onClick={() => onSelect(command)}
            onMouseEnter={() => onHover(absoluteIndex)}
            role="option"
            type="button"
          >
            <span className="slash-command-item-icon">
              {getSlashCommandIcon(command)}
            </span>
            <span className="slash-command-item-body">
              <span className="slash-command-item-title">{command.title}</span>
              <span className="slash-command-item-description">
                {command.description}
              </span>
            </span>
            {command.scope ? (
              <span className="slash-command-item-scope">{command.scope}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
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
