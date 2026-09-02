import type React from "react";
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useCallback,
  useRef,
  useState,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import {
  Activity,
  Archive,
  ArrowUp,
  Box,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  File,
  FileText,
  Folder,
  GitFork,
  GitBranch,
  Globe2,
  Hand,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Paperclip,
  Plus,
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
} from "../../../components/ui/iconTokens.js";
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
  DesktopFileEntry,
  LocalRouterMode,
  ModelProviderID,
} from "../../../../shared/types.js";
import type { ModelPreset } from "../../../modelPresets.js";
import { ChipButton } from "../../../components/ui/ChipButton.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { MetaChip } from "../../../components/ui/MetaChip.js";
import { SessionFollowUpDock } from "../SessionFollowUpDock.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { SearchablePopoverContent } from "../../../components/ui/SearchablePopoverContent.js";
import { buildPopoverSizingStyle } from "../../../components/ui/popoverSizing.js";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover.js";
import { ChatInputDropdown } from "./ChatInputDropdown.js";
import { BranchSelectPopover } from "./BranchSelectPopover.js";
import { ModelPickerPopover } from "./ModelPickerPopover.js";
import {
  resolveThinkingLabel,
  resolveThinkingOptions,
} from "./ThinkingLevelPopover.js";
import { ComposerStatusOverlay } from "./ComposerStatusOverlay.js";
import type {
  ComposerEditorHandle,
  ComposerEditorProps,
} from "./ComposerEditor.js";
import {
  DEFAULT_COMPOSER_CAPABILITIES,
  isInlineComposerFailure,
  type ComposerCapabilities,
  type ComposerBrowserContext,
  type ComposerContextTask,
  type ComposerDocument,
  type ComposerDraftKey,
  type ComposerDeliveryIntent,
  type ComposerLayout,
  type ComposerPlacement,
  type ComposerRadiusVariant,
  type ComposerSubmitOutcome,
  type ComposerSubmitShortcut,
  type ComposerSurface,
  type ComposerUtilityBarVariant,
  type WorkingPlugin,
} from "./composerTypes.js";
import {
  createComposerDocumentWithSkill,
  skillInvocationFromComposerToken,
} from './composerSkillToken.js';
import {
  getActiveSkillTokenQuery,
  getActiveSlashCommandQuery,
  mergeSlashCommands,
  parseSlashInvocation,
  type ComposerCommand,
  type ComposerSkillCommand,
  type ComposerSlashCommand,
  type ComposerSlashCommandId,
} from "./composerSlashCommands.js";
import { useComposerSlashCommands } from "./useComposerSlashCommands.js";
import { BuiltinSkillIcon, skillScopeLabel } from "../../plugins/builtinSkillPresentation.js";
import { buildThreadDeepLink } from '@codepilotx/shared/thread-reference'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import {
  ComposerCommandMenu,
  composerMenuItemId,
  filterComposerMenuItems,
  type ComposerMenuItem,
} from './ComposerCommandMenu.js'
import { SessionGroupEditorDialog } from '../../session-groups/SessionGroupEditorDialog.js'
import { SessionGroupSwitcherPopover } from '../../session-groups/SessionGroupSwitcherPopover.js'
import { readPreferredSessionGroupId, writePreferredSessionGroupId } from '../../session-groups/sessionGroupPreference.js'
import type { DesktopSessionGroup } from '../../../services/desktop-client/types.js'

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
  | "session-group"
  | "mode"
  | "branch"
  | "status"
  | "goal"
  | "plugin";

const PERMISSION_CHIP_CLASS_NAMES: Record<DesktopPermissionMode, string> = {
  default: "permission-chip permission-chip-default",
  "auto-review": "permission-chip permission-chip-auto",
  "full-access": "permission-chip permission-chip-bypassPermissions",
  custom: "permission-chip permission-chip-customConfig",
};

type Props = {
  draftKey: ComposerDraftKey;
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
  document?: ComposerDocument;
  skillCommands?: ComposerSkillCommand[];
  selectedSkillToken?: ComposerSkillCommand;
  contextTasks?: ComposerContextTask[];
  browserContext?: ComposerBrowserContext | null;
  placeholder?: string;
  onChooseWorkspace: () => void;
  onInputChange: (value: string) => void;
  onDocumentChange?: (document: ComposerDocument) => void;
  onSkillTokenActivate?: (skill: { name: string; path: string }) => void;
  onInterrupt: () => void;
  onProviderModelChange: (
    providerID: ModelProviderID,
    modelPresetID: string,
  ) => void;
  onProviderOpen?: (providerID: ModelProviderID) => void;
  onProviderSearch?: (providerID: ModelProviderID, query: string) => void;
  onAddFiles?: (files: FileList) => void;
  onAddFilePaths?: (paths: string[]) => Promise<void>;
  onRemoveAttachment?: (attachmentId: string) => void;
  onOpenAttachment?: (attachment: DesktopComposerAttachment) => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onCloneGithub?: () => void;
  onClearWorkspace: () => void;
  onOpenMcpSettings?: () => void;
  onOpenSideChat?: () => void;
  onForkConversation?: () => void;
  canForkConversation?: boolean;
  onArchiveConversation?: () => void;
  onBranchSelect: (branch: string) => void;
  onCreateBranch: () => void;
  onStartReview?: (
    target:
      | { type: "uncommittedChanges" }
      | { type: "baseBranch"; branch: string },
  ) => void;
  onPermissionChange: (value: DesktopPermissionMode) => void;
  onPlanModeChange?: (active: boolean) => void;
  onLocalRouterModeChange?: (mode: LocalRouterMode) => void;
  onSubmit: (delivery?: ComposerDeliveryIntent) => void;
  onCompact?: () => Promise<void>;
  onCommandError?: (message: string) => void;
  onThinkingChange: (value: DesktopThinkingMode) => void;
  onSkillSelect?: (skill: ComposerSkillCommand) => void;
  hasConversationMessages?: boolean;
  routedSessionId?: string | null;
  contextDropdownSide?: "top" | "bottom";
  queuedFollowUps?: DesktopQueuedFollowUp[];
  queuePauseReason?: DesktopQueuePauseReason | null;
  onFollowUpEdit?: (followUpId: string, input: DesktopUserMessageInput) => void;
  onFollowUpRemove?: (followUpId: string) => void;
  onFollowUpResume?: () => void;
  threadGoal?: DesktopThreadGoal | null;
  onGoalPause?: () => void;
  onGoalResume?: () => void;
  onGoalComplete?: () => void;
  onGoalClear?: () => void;
  placement?: ComposerPlacement;
  capabilities?: Partial<ComposerCapabilities>;
  submitting?: boolean;
  submitOutcome?: ComposerSubmitOutcome | null;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  submitShortcut?: ComposerSubmitShortcut;
  surface?: ComposerSurface;
  layout?: ComposerLayout;
  radiusVariant?: ComposerRadiusVariant;
  utilityBarVariant?: ComposerUtilityBarVariant;
  workingPlugin?: WorkingPlugin | null;
  onWorkingPluginChange?: (plugin: WorkingPlugin | null) => void;
};

const ComposerEditor = lazy(async () => {
  const module = await import("./ComposerEditor.js");
  return {
    default: module.ComposerEditor as React.ForwardRefExoticComponent<
      ComposerEditorProps & React.RefAttributes<ComposerEditorHandle>
    >,
  };
});

const ComposerAttachmentTray = lazy(async () => {
  const module = await import("./ComposerAttachmentTray.js");
  return { default: module.ComposerAttachmentTray };
});
const ComposerDictationControl = lazy(async () => {
  const module = await import('./ComposerDictationControl.js')
  return { default: module.ComposerDictationControl }
})

export function ComposerCard({
  draftKey,
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
  document,
  skillCommands = [],
  selectedSkillToken,
  contextTasks = [],
  browserContext,
  placeholder = "随心输入",
  onChooseWorkspace,
  onInputChange,
  onDocumentChange,
  onSkillTokenActivate,
  onInterrupt,
  onProviderModelChange,
  onProviderOpen,
  onProviderSearch,
  onAddFiles,
  onAddFilePaths,
  onRemoveAttachment,
  onOpenAttachment,
  onOpenWorkspace,
  onCloneGithub,
  onClearWorkspace,
  onOpenMcpSettings,
  onOpenSideChat,
  onForkConversation,
  canForkConversation = false,
  onArchiveConversation,
  onBranchSelect,
  onCreateBranch,
  onStartReview,
  onPermissionChange,
  onPlanModeChange,
  onLocalRouterModeChange,
  onSubmit,
  onCompact,
  onCommandError,
  onThinkingChange,
  onSkillSelect,
  hasConversationMessages = false,
  routedSessionId,
  contextDropdownSide: contextDropdownSideOverride,
  queuedFollowUps,
  queuePauseReason,
  onFollowUpEdit,
  onFollowUpRemove,
  onFollowUpResume,
  threadGoal,
  onGoalPause,
  onGoalResume,
  onGoalComplete,
  onGoalClear,
  placement = "thread",
  capabilities: capabilityOverrides,
  submitting = false,
  submitOutcome,
  onCompositionStart,
  onCompositionEnd,
  submitShortcut = "enter",
  surface,
  layout = "multiline",
  radiusVariant = "default",
  utilityBarVariant = "default",
  workingPlugin,
  onWorkingPluginChange,
}: Props): React.ReactNode {
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const menuId = useId();
  const menuItemId = (key: string): string =>
    `${menuId}-item-${encodeURIComponent(key)}`;
  const capabilities = useMemo(
    () => ({ ...DEFAULT_COMPOSER_CAPABILITIES, ...capabilityOverrides }),
    [capabilityOverrides],
  );
  const dictationToggleRef = useRef<(() => void) | null>(null);
  const registerDictationToggle = useCallback((toggle: (() => void) | null) => {
    dictationToggleRef.current = toggle;
  }, []);
  const submitErrorId = `${menuId}-submit-error`;
  const inlineSubmitFailure = isInlineComposerFailure(submitOutcome)
    ? submitOutcome
    : null;
  const subagentMode = placement === "side-task";
  const contextDropdownSide = contextDropdownSideOverride ?? "top";
  const [openDropdown, setOpenDropdown] = useState<ComposerDropdown | null>(
    null,
  );
  const [selectedSessionGroup, setSelectedSessionGroup] = useState<DesktopSessionGroup | null>(null)
  const [sessionGroupEditorOpen, setSessionGroupEditorOpen] = useState(false)
  const [sessionGroupDraftName, setSessionGroupDraftName] = useState('')
  const [sessionGroupDraftDescription, setSessionGroupDraftDescription] = useState('')
  const [sessionGroupSaving, setSessionGroupSaving] = useState(false)
  const [sessionGroupCreateError, setSessionGroupCreateError] = useState<string | null>(null)

  const openSessionGroupEditor = useCallback(() => {
    setSessionGroupDraftName('')
    setSessionGroupDraftDescription('')
    setSessionGroupCreateError(null)
    setSessionGroupEditorOpen(true)
  }, [])

  const createSessionGroup = useCallback(async () => {
    const name = sessionGroupDraftName.trim()
    if (!name || sessionGroupSaving) return
    setSessionGroupSaving(true)
    setSessionGroupCreateError(null)
    try {
      const { desktopClient } = await import('../../../services/desktop-client/index.js')
      const group = await desktopClient.createSessionGroup({
        name,
        description: sessionGroupDraftDescription.trim(),
      })
      setSelectedSessionGroup(group)
      writePreferredSessionGroupId(group.id)
      setSessionGroupEditorOpen(false)
    } catch (cause) {
      setSessionGroupCreateError(
        cause instanceof Error ? cause.message : '会话组创建失败，请重试。',
      )
    } finally {
      setSessionGroupSaving(false)
    }
  }, [sessionGroupDraftDescription, sessionGroupDraftName, sessionGroupSaving])

  useEffect(() => {
    const preferredId = readPreferredSessionGroupId()
    if (!preferredId) return
    let active = true
    void import('../../../services/desktop-client/index.js').then(({ desktopClient }) =>
      desktopClient.listSessionGroups(),
    ).then(groups => {
      if (!active) return
      const preferred = groups.find(group => group.id === preferredId) ?? null
      setSelectedSessionGroup(preferred)
      if (!preferred) writePreferredSessionGroupId(null)
    }).catch(() => {})
    return () => { active = false }
  }, [])
  const [thinkingPreviewMode, setThinkingPreviewMode] =
    useState<DesktopThinkingMode | null>(null);
  const [reviewMenuRequested, setReviewMenuRequested] = useState(false);
  const [buttonContextRequest, setButtonContextRequest] = useState<{
    start: number;
    end: number;
    query: string;
    input: string;
  } | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [dismissedSlashInput, setDismissedSlashInput] = useState<string | null>(
    null,
  );
  const [isComposing, setIsComposing] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);

  useEffect(() => {
    const clearFileDrag = (): void => {
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
    };
    window.addEventListener("dragend", clearFileDrag);
    window.addEventListener("drop", clearFileDrag);
    return () => {
      window.removeEventListener("dragend", clearFileDrag);
      window.removeEventListener("drop", clearFileDrag);
    };
  }, []);

  useEffect(() => {
    if (submitOutcome?.status === "failed") editorRef.current?.focus();
  }, [submitOutcome]);
  const [dismissedMention, setDismissedMention] = useState<number | null>(null);
  const [dismissedSkillInput, setDismissedSkillInput] = useState<string | null>(
    null,
  );
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [contextDirectory, setContextDirectory] = useState('.');
  const [contextEntries, setContextEntries] = useState<DesktopFileEntry[]>([]);
  const [contextEntriesLoading, setContextEntriesLoading] = useState(false);
  const [contextEntriesError, setContextEntriesError] = useState<string | null>(null);
  const [contextReloadToken, setContextReloadToken] = useState(0);
  const contextLoadGenerationRef = useRef(0);
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
      ? "配置模型"
      : (selectedModel?.label ?? "未选择模型");
  const selectedModelTitle = modelCatalogLoading
    ? "加载模型列表中……"
    : !modelConfigured
      ? "打开模型配置"
      : (selectedModel?.label ?? "未选择模型");
  const effectiveThinkingOptions = resolveThinkingOptions(
    deepSeekThinkingControls,
    thinkingOptions,
  );
  const selectedThinkingLabel = resolveThinkingLabel(
    effectiveThinkingOptions,
    thinkingPreviewMode ?? thinkingMode,
  );
  const composerDocument = useMemo(
    () => document ?? (selectedSkillToken
      ? createComposerDocumentWithSkill(input, {
          name: selectedSkillToken.skill.name,
          path: selectedSkillToken.skill.path,
        })
      : undefined),
    [document, input, selectedSkillToken],
  );

  const sessionBusy =
    sessionStatus === "running" || sessionStatus === "waiting";
  const { commands: builtinSlashCommands, executeCommand } =
    useComposerSlashCommands({
      capabilities,
      planModeActive,
      goalModeEnabled,
      hasConversationMessages,
      hasThread: Boolean(routedSessionId),
      canReview: Boolean(onStartReview && workspace),
      subagentMode,
      sessionBusy,
      reasoningAvailable: showThinkingOptions,
      onOpenModel: () => setOpenDropdown("model"),
      onOpenReasoning: () => setOpenDropdown("model"),
      onOpenStatus: () => setOpenDropdown("status"),
      onOpenMcp: onOpenMcpSettings,
      onPlanModeChange,
      onGoalModeChange,
      onOpenReview: () => setReviewMenuRequested(true),
      onCompact,
      onOpenSide: onOpenSideChat,
      onFork: onForkConversation,
      onArchive: () => setArchiveConfirmationOpen(true),
      onChooseProject: onChooseWorkspace,
      onClearProject: onClearWorkspace,
      showThreadActions:
        placement === 'thread' && !subagentMode && Boolean(routedSessionId),
      showNewSessionActions: placement === 'new-session' && !subagentMode,
      canFork: canForkConversation,
      hasProject: Boolean(workspace),
      onError: onCommandError,
    });

  const activeSlashQuery = useMemo(() => {
    if (isComposing || dismissedSlashInput === input) return null;
    return getActiveSlashCommandQuery(input, selectionStart);
  }, [dismissedSlashInput, input, isComposing, selectionStart]);

  const activeMention = useMemo(() => {
    if (isComposing) return null;
    if (dismissedMention !== null) return null;
    return getActiveComposerMention(input, selectionStart);
  }, [input, isComposing, dismissedMention, selectionStart]);
  const activeContextRequest = activeMention ?? (
    buttonContextRequest?.input === input ? buttonContextRequest : null
  );
  const buttonContextOpen = Boolean(
    buttonContextRequest && buttonContextRequest.input === input,
  );

  useEffect(() => {
    if (activeMention && buttonContextRequest) setButtonContextRequest(null);
  }, [activeMention, buttonContextRequest]);

  const activeSkillQuery = useMemo(() => {
    if (isComposing || dismissedSkillInput === input) return null;
    return getActiveSkillTokenQuery(input, selectionStart);
  }, [dismissedSkillInput, input, isComposing, selectionStart]);

  const showSlashContextDropdown =
    Boolean(activeSlashQuery) && !activeContextRequest && !activeSkillQuery;

  useEffect(() => {
    const generation = ++contextLoadGenerationRef.current;
    if (!activeContextRequest || !workspace) {
      setContextDirectory('.');
      setContextEntries([]);
      setContextEntriesError(null);
      setContextEntriesLoading(false);
      return;
    }
    setContextEntriesLoading(true);
    setContextEntriesError(null);
    void desktopClient
      .listWorkspaceFiles(
        workspace.path,
        contextDirectory,
        workspace.primaryFolderId,
        workspace.projectId,
      )
      .then(entries => {
        if (contextLoadGenerationRef.current === generation) setContextEntries(entries);
      })
      .catch(error => {
        if (contextLoadGenerationRef.current === generation) {
          setContextEntries([]);
          setContextEntriesError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (contextLoadGenerationRef.current === generation) setContextEntriesLoading(false);
      });
  }, [Boolean(activeContextRequest), contextDirectory, contextReloadToken, workspace]);

  const slashMenuItems = useMemo(
    () =>
      mergeSlashCommands(builtinSlashCommands, skillCommands).map((command) =>
        composerCommandMenuItem(command, executeCommand, onSkillSelect),
      ),
    [builtinSlashCommands, executeCommand, onSkillSelect, skillCommands],
  );
  const skillMenuItems = useMemo(
    () =>
      skillCommands.map((command) =>
        composerCommandMenuItem(command, executeCommand, onSkillSelect),
      ),
    [executeCommand, onSkillSelect, skillCommands],
  );
  const reviewMenuItems = useMemo((): ComposerMenuItem[] => [
    {
      key: 'code-review-uncommitted',
      label: '审阅未提交的更改',
      description: '审查当前工作树和暂存区中的变更',
      icon: <ShieldCheck size={14} />,
      matchText: '代码审查 review uncommitted',
      onSelect: () => onStartReview?.({ type: 'uncommittedChanges' }),
    },
    ...branches
      .filter(candidate => candidate && candidate !== branchName)
      .slice(0, 6)
      .map(branch => ({
        key: `code-review-branch:${branch}`,
        label: `与 ${branch} 比较`,
        description: '从 merge-base 开始审阅当前分支的变更',
        icon: <GitBranch size={14} />,
        matchText: `代码审查 branch review ${branch}`,
        onSelect: () => onStartReview?.({ type: 'baseBranch', branch }),
      })),
  ], [branchName, branches, onStartReview]);

  const mentionMenuItems = useMemo((): ComposerMenuItem[] => {
    if (!activeContextRequest) return [];
    const insertReference = (
      kind: 'thread' | 'browser',
      label: string,
      value: string,
    ): void => {
      editorRef.current?.replaceTextRangeWithToken(activeContextRequest.start, activeContextRequest.end, {
        id: crypto.randomUUID(),
        kind,
        label,
        value,
        from: activeContextRequest.start,
        to: activeContextRequest.start,
      });
      closeDropdown();
    };
    const items: ComposerMenuItem[] = contextTasks.map(task => ({
      key: `thread:${task.id}`,
      section: '最近任务',
      label: task.title,
      description: task.workspaceName,
      icon: <MessageSquare size={14} />,
      matchText: `${task.title} ${task.workspaceName ?? ''} task thread`,
      onSelect: () => insertReference('thread', `任务：${task.title}`, buildThreadDeepLink(task.id)),
    }));
    if (browserContext) {
      items.push({
        key: 'browser:current',
        section: '浏览器',
        label: browserContext.title || browserContext.url,
        description: browserContext.url,
        icon: <Globe2 size={14} />,
        matchText: `${browserContext.title} ${browserContext.url} browser 网页`,
        onSelect: () => insertReference('browser', `网页：${browserContext.title || browserContext.url}`, browserContext.url),
      });
    }
    if (workspace && capabilities.fileAttachments && onAddFilePaths) {
      if (contextDirectory !== '.') {
        items.push({
          key: 'files:parent',
          section: '文件和文件夹',
          label: '返回上一级',
          description: parentWorkspacePath(contextDirectory),
          icon: <ChevronLeft size={14} />,
          matchText: '返回 上一级 parent',
          onSelect: () => {
            setContextDirectory(parentWorkspacePath(contextDirectory));
            if (activeMention) {
              editorRef.current?.replaceTextRange(activeMention.start, activeMention.end, '@');
            }
          },
        });
      }
      items.push({
        key: `files:current:${contextDirectory}`,
        section: '文件和文件夹',
        label: '引用当前目录',
        description: contextDirectory === '.' ? workspace.name : contextDirectory,
        icon: <Folder size={14} />,
        matchText: `引用 当前 目录 ${contextDirectory}`,
        onSelect: () => void addWorkspaceContextPath(contextDirectory, activeContextRequest),
      });
      for (const entry of contextEntries) {
        items.push({
          key: `files:${entry.type}:${entry.path}`,
          section: '文件和文件夹',
          label: entry.name,
          description: entry.path,
          meta: entry.type === 'directory' ? '进入' : undefined,
          icon: entry.type === 'directory' ? <Folder size={14} /> : <File size={14} />,
          matchText: `${entry.name} ${entry.path}`,
          onSelect: entry.type === 'directory'
            ? () => {
                setContextDirectory(entry.path);
                if (activeMention) {
                  editorRef.current?.replaceTextRange(activeMention.start, activeMention.end, '@');
                }
              }
            : () => void addWorkspaceContextPath(entry.path, activeContextRequest),
        });
      }
      if (contextEntriesLoading) {
        items.push({
          key: 'files:loading',
          section: '文件和文件夹',
          label: '正在加载…',
          icon: <Activity size={14} />,
          matchText: 'loading 加载',
          disabled: true,
          onSelect: () => {},
        });
      } else if (contextEntriesError) {
        items.push({
          key: 'files:retry',
          section: '文件和文件夹',
          label: '重新加载',
          description: contextEntriesError,
          icon: <Activity size={14} />,
          matchText: 'retry 重试 重新加载',
          onSelect: () => setContextReloadToken(value => value + 1),
        });
      }
    }
    return items;
  }, [
    activeContextRequest,
    activeMention,
    browserContext,
    capabilities.fileAttachments,
    contextDirectory,
    contextEntries,
    contextEntriesError,
    contextEntriesLoading,
    contextTasks,
    onAddFilePaths,
    workspace,
  ]);
  const activeMenuScopeRef = useRef("");
  const [storedActiveMenuKey, setStoredActiveMenuKey] = useState<string | null>(
    null,
  );
  const activeMenuKeyword = reviewMenuRequested
    ? ""
    : activeSkillQuery
      ? activeSkillQuery.query
      : (activeContextRequest?.query ?? activeSlashQuery?.query ?? '');
  const activeMenuItems = useMemo(() => {
    const source = reviewMenuRequested
      ? reviewMenuItems
      : activeSkillQuery
        ? skillMenuItems
        : activeContextRequest
          ? mentionMenuItems
          : slashMenuItems;
    return filterComposerMenuItems(source, activeMenuKeyword);
  }, [
    activeMenuKeyword,
    activeSkillQuery,
    activeContextRequest,
    mentionMenuItems,
    reviewMenuItems,
    reviewMenuRequested,
    skillMenuItems,
    slashMenuItems,
  ]);
  const unifiedMenuOpen =
    showSlashContextDropdown ||
    Boolean(activeContextRequest) ||
    Boolean(activeSkillQuery) ||
    reviewMenuRequested;

  const activeMenuScopeKey = `${reviewMenuRequested
    ? 0
    : activeSkillQuery
      ? 1
      : activeContextRequest
        ? `2:${activeContextRequest.start}:${contextDirectory}`
        : 3}:${activeMenuKeyword}`;
  const firstActiveMenuKey =
    activeMenuItems[firstEnabledMenuIndex(activeMenuItems)]?.key ?? null;
  const storedActiveMenuAvailable = activeMenuItems.some(
    (item) => item.key === storedActiveMenuKey && !item.disabled,
  );
  const activeMenuKey = unifiedMenuOpen
    ? activeMenuScopeRef.current === activeMenuScopeKey &&
      storedActiveMenuAvailable
      ? storedActiveMenuKey
      : firstActiveMenuKey
    : null;
  const activeMenuItem = activeMenuItems.find(
    (item) => item.key === activeMenuKey,
  );
  const activeMenuIndex = activeMenuItem
    ? activeMenuItems.indexOf(activeMenuItem)
    : -1;

  function setActiveMenuKey(itemKey: string | null): void {
    activeMenuScopeRef.current = activeMenuScopeKey;
    setStoredActiveMenuKey(itemKey);
  }

  useEffect(() => {
    if (!unifiedMenuOpen) {
      activeMenuScopeRef.current = "";
      return;
    }
    if (
      activeMenuScopeRef.current === activeMenuScopeKey &&
      storedActiveMenuAvailable
    ) {
      return;
    }
    activeMenuScopeRef.current = activeMenuScopeKey;
    setStoredActiveMenuKey(firstActiveMenuKey);
  }, [
    activeMenuScopeKey,
    firstActiveMenuKey,
    storedActiveMenuAvailable,
    unifiedMenuOpen,
  ]);

  useEffect(() => {
    if (dismissedSlashInput !== null && dismissedSlashInput !== input) {
      setDismissedSlashInput(null);
    }
  }, [dismissedSlashInput, input]);

  useEffect(() => {
    if (dismissedSkillInput !== null && dismissedSkillInput !== input) {
      setDismissedSkillInput(null);
    }
  }, [dismissedSkillInput, input]);

  useEffect(() => {
    // Reset mention dismissal when input changes away from the @ position
    if (dismissedMention !== null) {
      const atIndex = input.lastIndexOf("@", dismissedMention);
      if (atIndex === -1 || input.slice(atIndex).includes(" ")) {
        setDismissedMention(null);
      }
    }
  }, [input, dismissedMention]);

  function closeDropdown(): void {
    setOpenDropdown(null);
    setReviewMenuRequested(false);
    setButtonContextRequest(null);
  }

  function handleUnifiedSlashSelect(item: ComposerMenuItem): void {
    if (item.disabled || !activeSlashQuery) return;
    editorRef.current?.replaceTextRange(activeSlashQuery.start, activeSlashQuery.end, '');
    setDismissedSlashInput(input);
    // Same logic as handleUnifiedPlusSelect: skip closeDropdown for items
    // that open a sub-dropown, otherwise React batches both setOpenDropdown
    // calls and the sub-dropdown never opens.
    const managesOwnDropdown =
      item.command?.source === "builtin" &&
      (item.command.id === "status" ||
        item.command.id === "model" ||
        item.command.id === "reasoning" ||
        item.command.id === "review");
    item.onSelect();
    if (!managesOwnDropdown) {
      closeDropdown();
    }
  }

  function handleUnifiedMentionSelect(item: ComposerMenuItem): void {
    if (!item.disabled) item.onSelect();
  }

  async function addWorkspaceContextPath(
    relativePath: string,
    mention: { start: number; end: number },
  ): Promise<void> {
    if (!workspace || !onAddFilePaths) return;
    try {
      await onAddFilePaths(resolveWorkspaceContextPath(workspace.path, relativePath));
      editorRef.current?.replaceTextRange(mention.start, mention.end, '');
      closeDropdown();
    } catch (error) {
      onCommandError?.(error instanceof Error ? error.message : String(error));
    }
  }

  function handleSkillQuerySelect(item: ComposerMenuItem): void {
    if (item.disabled || !activeSkillQuery) return;
    editorRef.current?.replaceTextRange(activeSkillQuery.start, activeSkillQuery.end, '');
    item.onSelect();
    closeDropdown();
  }

  function handleReviewSelect(item: ComposerMenuItem): void {
    if (item.disabled) return;
    item.onSelect();
    setReviewMenuRequested(false);
  }

  function handleDirectSlashSubmission(): boolean {
    const parsed = parseSlashInvocation(input, builtinSlashCommands);
    if (parsed.kind === "unknown") return false;
    if (parsed.kind === "disabled") {
      onCommandError?.(parsed.reason);
      return true;
    }
    onInputChange("");
    void executeCommand(parsed.command);
    return true;
  }

  function handleFileDrop(event: React.DragEvent<HTMLDivElement>): void {
    if (!onAddFiles) return;
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    onAddFiles(event.dataTransfer.files);
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
  const promptCacheReadTokens = contextUsage?.promptCacheReadTokens ?? 0;
  const promptCacheWriteTokens = contextUsage?.promptCacheWriteTokens ?? 0;
  const promptUncachedTokens = contextUsage?.promptUncachedTokens ?? 0;
  const promptCacheTotalTokens =
    promptCacheReadTokens + promptCacheWriteTokens + promptUncachedTokens;
  const promptCacheHitRate =
    promptCacheTotalTokens > 0
      ? Math.round((promptCacheReadTokens / promptCacheTotalTokens) * 100)
      : 0;
  const reasoningTokens = contextUsage?.reasoningTokens ?? 0;
  const showContextUsageDetails =
    promptCacheTotalTokens > 0 || reasoningTokens > 0;
  const usedPercent = contextUsage
    ? Math.min(100, Math.max(0, contextUsage.usedPercent))
    : 0;
  return (
    <div
      className="composer-stack tw:relative tw:flex tw:w-full tw:flex-col"
      data-placement={placement}
      data-surface={surface}
      data-composer-layout={layout}
      data-composer-radius-variant={radiusVariant}
      data-composer-utility-bar-variant={utilityBarVariant}
      aria-busy={submitting}
      onDragEnter={(event) => {
        if (!onAddFiles || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        fileDragDepthRef.current += 1;
        setFileDragActive(true);
      }}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) return;
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) setFileDragActive(false);
      }}
      onDragOver={(event) => {
        if (onAddFiles && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={handleFileDrop}
    >
      {fileDragActive ? (
        <div
          className="tw:absolute tw:inset-0 tw:z-50 tw:flex tw:items-center tw:justify-center tw:rounded-xl tw:border tw:border-dashed tw:border-app-border-strong tw:bg-app-raised u-type-control"
          role="status"
        >
          松开以添加文件
        </div>
      ) : null}
      <div
        className="composer composer-input-surface composer-top tw:relative tw:flex tw:min-h-0 tw:flex-col tw:justify-between"
        inert={submitting || undefined}
      >
        {inlineSubmitFailure ? (
          <div
            className="composer-submit-error"
            id={submitErrorId}
            role="alert"
          >
            {inlineSubmitFailure.message}，请修改后重试。
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <Suspense fallback={null}>
            <ComposerAttachmentTray
              attachments={attachments}
              onOpen={onOpenAttachment}
              onRemove={onRemoveAttachment}
            />
          </Suspense>
        ) : null}
        <div
          className="composer-input tw:flex tw:min-w-0 tw:items-start"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget)
              editorRef.current?.focus();
          }}
        >
          <Suspense
            fallback={
              <div aria-hidden="true" className="composer-editor">
                <div
                  className="composer-editor-content is-empty"
                  data-placeholder={composerPlaceholder}
                />
              </div>
            }
          >
            <ComposerEditor
              ariaActiveDescendant={
                unifiedMenuOpen && activeMenuKey
                  ? composerMenuItemId(menuId, activeMenuKey)
                  : undefined
              }
              ariaControls={unifiedMenuOpen ? menuId : undefined}
              ariaDescribedBy={
                inlineSubmitFailure ? submitErrorId : undefined
              }
              ariaExpanded={unifiedMenuOpen}
              ref={editorRef}
              document={composerDocument}
              value={input}
              onChange={onInputChange}
              onDocumentChange={(nextDocument) => {
                if (onDocumentChange) onDocumentChange(nextDocument);
                else onInputChange(nextDocument.text);
              }}
              onTokenActivate={(token) => {
                const skill = skillInvocationFromComposerToken(token);
                if (skill) onSkillTokenActivate?.(skill);
              }}
              onSelectionChange={setSelectionStart}
              onCompositionChange={(composing) => {
                setIsComposing(composing);
                if (composing) onCompositionStart?.();
                else onCompositionEnd?.();
              }}
              onKeyDown={(event) => {
                if (event.isComposing || event.keyCode === 229) return false;
                if (
                  event.ctrlKey && event.shiftKey && !event.altKey
                  && event.key.toLowerCase() === "d"
                ) {
                  event.preventDefault();
                  dictationToggleRef.current?.();
                  return true;
                }
                if (unifiedMenuOpen) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const nextIndex = nextEnabledMenuIndex(
                      activeMenuItems,
                      activeMenuIndex,
                      event.key === "ArrowDown" ? 1 : -1,
                    );
                    const nextItem = activeMenuItems[nextIndex];
                    if (nextItem) setActiveMenuKey(nextItem.key);
                    return true;
                  }
                  if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    const boundaryIndex =
                      event.key === "Home"
                        ? firstEnabledMenuIndex(activeMenuItems)
                        : lastEnabledMenuIndex(activeMenuItems);
                    const boundaryItem = activeMenuItems[boundaryIndex];
                    if (boundaryItem) setActiveMenuKey(boundaryItem.key);
                    return true;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    const item = activeMenuItem;
                    if (item && !item.disabled) {
                      event.preventDefault();
                      if (reviewMenuRequested) handleReviewSelect(item);
                      else if (activeSkillQuery) handleSkillQuerySelect(item);
                      else if (activeContextRequest) handleUnifiedMentionSelect(item);
                      else handleUnifiedSlashSelect(item);
                      return true;
                    }
                  }
                }

                // Escape: dismiss dropdowns or interrupt session
                if (event.key === "Escape") {
                  if (showSlashContextDropdown) {
                    event.preventDefault();
                    setDismissedSlashInput(input);
                    return true;
                  }
                  if (activeMention) {
                    event.preventDefault();
                    setDismissedMention(activeMention.start);
                    return true;
                  }
                  if (buttonContextOpen) {
                    event.preventDefault();
                    setButtonContextRequest(null);
                    return true;
                  }
                  if (activeSkillQuery) {
                    event.preventDefault();
                    setDismissedSkillInput(input);
                    return true;
                  }
                  if (reviewMenuRequested) {
                    event.preventDefault();
                    setReviewMenuRequested(false);
                    return true;
                  }
                  if (
                    sessionStatus === "running" ||
                    sessionStatus === "waiting"
                  ) {
                    event.preventDefault();
                    onInterrupt();
                    return true;
                  }
                }

                if (event.key === "Backspace" && input.length === 0) {
                  if (goalModeEnabled) {
                    event.preventDefault();
                    onGoalModeChange?.(false);
                    return true;
                  }
                  if (planModeActive) {
                    event.preventDefault();
                    onPlanModeChange?.(false);
                    return true;
                  }
                }

                const delivery = resolveComposerSubmitIntent(
                  event,
                  submitShortcut,
                  input,
                );
                if (!delivery) return false;
                event.preventDefault();
                if (handleDirectSlashSubmission()) return true;
                if (canSubmit) onSubmit(delivery);
                return true;
              }}
              onPasteFiles={(files) => {
                if (!onAddFiles) return false;
                if (files.length === 0) return false;
                onAddFiles(files);
                return true;
              }}
              placeholder={composerPlaceholder}
            />
          </Suspense>
        </div>

        <ChatInputDropdown
          open={showSlashContextDropdown}
          side={contextDropdownSide}
          width="100%"
          maxWidth="100%"
          onClose={() => {
            setDismissedSlashInput(input);
          }}
        >
              <ComposerCommandMenu
                id={menuId}
                activeKey={activeMenuKey}
                items={slashMenuItems}
                keyword={activeSlashQuery?.query ?? ''}
            onActiveKeyChange={setActiveMenuKey}
            onItemSelect={handleUnifiedSlashSelect}
          />
        </ChatInputDropdown>

        <ChatInputDropdown
          open={Boolean(activeSkillQuery)}
          side={contextDropdownSide}
          width="100%"
          maxWidth="100%"
          onClose={() => setDismissedSkillInput(input)}
        >
              <ComposerCommandMenu
                id={menuId}
            activeKey={activeMenuKey}
            items={skillMenuItems}
            keyword={activeSkillQuery?.query ?? ""}
            onActiveKeyChange={setActiveMenuKey}
            onItemSelect={handleSkillQuerySelect}
          />
        </ChatInputDropdown>

        <ChatInputDropdown
          open={reviewMenuRequested}
          side={contextDropdownSide}
          width="100%"
          maxWidth="100%"
          onClose={() => setReviewMenuRequested(false)}
        >
              <ComposerCommandMenu
                id={menuId}
            activeKey={activeMenuKey}
            items={reviewMenuItems}
            keyword=""
            onActiveKeyChange={setActiveMenuKey}
            onItemSelect={handleReviewSelect}
          />
        </ChatInputDropdown>

        <ChatInputDropdown
          open={Boolean(activeContextRequest)}
          side={contextDropdownSide}
          width="100%"
          maxWidth="100%"
          onClose={() => {
            if (activeMention) setDismissedMention(activeMention.start);
            setButtonContextRequest(null);
          }}
        >
              <ComposerCommandMenu
                id={menuId}
            activeKey={activeMenuKey}
            items={mentionMenuItems}
            keyword={activeContextRequest?.query ?? ""}
            onActiveKeyChange={setActiveMenuKey}
            onItemSelect={handleUnifiedMentionSelect}
          />
        </ChatInputDropdown>

        <div className="composer-toolbar tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:pt-2">
          <div className="toolbar-left tw:flex tw:min-w-0 tw:items-center tw:gap-1.5">
            <IconButton
              active={buttonContextOpen}
              aria-expanded={buttonContextOpen}
              color={buttonContextOpen ? "ghostActive" : "ghostSecondary"}
              size="composer"
              title="添加文件等内容"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (buttonContextOpen) {
                  setButtonContextRequest(null);
                  return;
                }
                setButtonContextRequest({
                  start: selectionStart,
                  end: selectionStart,
                  query: '',
                  input,
                });
                setDismissedMention(activeMention?.start ?? null);
                setDismissedSlashInput(input);
                setDismissedSkillInput(input);
              }}
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
                data-theme-component="dropdown-trigger"
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
                  data-theme-component="dropdown-surface"
                  collisionPadding={6}
                  position="popper"
                  side="bottom"
                  sideOffset={4}
                  style={buildPopoverSizingStyle({ width: 300 })}
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
                                缓存读取{" "}
                                {formatCompactNumber(promptCacheReadTokens)}{" "}
                                (命中率 {promptCacheHitRate}%)
                              </span>
                              <span>
                                缓存写入{" "}
                                {formatCompactNumber(promptCacheWriteTokens)}
                              </span>
                              <span>
                                未缓存{" "}
                                {formatCompactNumber(promptUncachedTokens)}
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
            <ModelPickerPopover
              align="end"
              deepSeekThinkingControls={deepSeekThinkingControls}
              open={openDropdown === "model"}
              providerOptions={providerOptions}
              selectedModelPreset={selectedModelPreset}
              selectedProviderID={selectedProviderID}
              showThinkingOptions={showThinkingOptions}
              side="top"
              sideOffset={4}
              thinkingMode={thinkingMode}
              thinkingPreviewMode={thinkingPreviewMode}
              thinkingOptions={thinkingOptions}
              trigger={
                <ChipButton
                  active={openDropdown === "model"}
                  aria-label={
                    showThinkingOptions
                      ? `模型与推理设置：${selectedModelLabel}，${selectedThinkingLabel}`
                      : `模型：${selectedModelLabel}`
                  }
                  className="subtle composer-model-chip"
                  loading={modelCatalogLoading}
                  title={
                    showThinkingOptions
                      ? `${selectedProvider?.displayName ?? "模型"} · ${selectedModelTitle} · 推理强度：${selectedThinkingLabel}`
                      : `${selectedProvider?.displayName ?? "模型"} · ${selectedModelTitle}`
                  }
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
              }
              onOpenChange={(open) => {
                if (!open) setThinkingPreviewMode(null);
                setOpenDropdown(open ? "model" : null);
              }}
              onProviderModelChange={onProviderModelChange}
              onProviderOpen={onProviderOpen}
              onProviderSearch={onProviderSearch}
              onThinkingChange={onThinkingChange}
              onThinkingPreviewChange={setThinkingPreviewMode}
            />

            {capabilities.dictation ? (
              <Suspense fallback={null}>
                <ComposerDictationControl
                  draftKey={draftKey}
                  editorRef={editorRef}
                  enabled
                  registerToggle={registerDictationToggle}
                />
              </Suspense>
            ) : null}

            <button
              aria-label={
                submitting
                  ? "正在发送"
                  : isRunning && !canSubmit
                    ? "停止"
                    : "发送"
              }
              className={`send-button${submitting ? " is-submitting" : ""}`}
              disabled={!isRunning && !canSubmit}
              onClick={
                isRunning && !canSubmit
                  ? onInterrupt
                  : () => onSubmit("default")
              }
              title={
                isRunning && !canSubmit
                  ? "停止 Esc"
                  : (submitDisabledReason ?? "发送")
              }
              type="button"
            >
              {submitting ? (
                <Activity aria-hidden="true" size={APP_ICON_SIZE} />
              ) : isRunning && !canSubmit ? (
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
        <ComposerStatusOverlay
          open={openDropdown === "status"}
          onClose={closeDropdown}
          routedSessionId={routedSessionId}
          contextUsage={contextUsage}
          selectedProviderID={selectedProviderID}
          side={contextDropdownSide}
        />
      </div>

      {placement !== "thread" ? (
        <div className="composer-bottom composer-utility-bar tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          {surface === "chat" ? null : subagentMode ? (
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
                  label={
                    workspace?.name ??
                    (surface === "working" ? "选择文件夹" : "进入项目工作")
                  }
                  title="选择项目"
                />
              }
            />
          )}

          <SessionGroupSwitcherPopover
            open={openDropdown === "session-group"}
            side="top"
            value={selectedSessionGroup?.id ?? null}
            onOpenChange={open => setOpenDropdown(open ? "session-group" : null)}
            onCreate={openSessionGroupEditor}
            onChange={group => {
              setSelectedSessionGroup(group)
              writePreferredSessionGroupId(group?.id ?? null)
            }}
            trigger={
              <MetaChip
                active={openDropdown === "session-group"}
                icon={<MessagesSquare size={APP_ICON_SIZE} />}
                label={selectedSessionGroup?.name ?? "会话组"}
                title={selectedSessionGroup ? `使用会话组：${selectedSessionGroup.name}` : "选择会话组（可不使用）"}
              />
            }
          />

          {workspace ? (
            <>
              {threadGoal ? (
                <PopoverMenu
                  className="popover-goal popover-menu--grid"
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
                    <div className="popover-item-text">
                      {threadGoal.objective}
                    </div>
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
                          closeDropdown();
                          onGoalPause?.();
                        }}
                      >
                        暂停
                      </PopoverItem>
                    ) : null}
                    {threadGoal.status === "paused" ? (
                      <PopoverItem
                        icon={<Target size={APP_ICON_SIZE} />}
                        onClick={() => {
                          closeDropdown();
                          onGoalResume?.();
                        }}
                      >
                        继续
                      </PopoverItem>
                    ) : null}
                    {threadGoal.status !== "complete" ? (
                      <PopoverItem
                        icon={<Check size={APP_ICON_SIZE} />}
                        onClick={() => {
                          closeDropdown();
                          onGoalComplete?.();
                        }}
                      >
                        标记完成
                      </PopoverItem>
                    ) : null}
                    <PopoverItem
                      icon={<X size={APP_ICON_SIZE} />}
                      onClick={() => {
                        closeDropdown();
                        onGoalClear?.();
                      }}
                    >
                      清除目标
                    </PopoverItem>
                  </div>
                </PopoverMenu>
              ) : null}

              {surface !== "working" ? (
                <BranchSelectPopover
                  align="end"
                  branchSearch={branchSearch}
                  branches={branches}
                  className="popover-branch"
                  currentBranchName={branchName}
                  open={openDropdown === "branch"}
                  side="top"
                  width={420}
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
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <SessionFollowUpDock
        items={queuedFollowUps ?? []}
        pauseReason={queuePauseReason}
        onEdit={onFollowUpEdit ?? (() => {})}
        onRemove={onFollowUpRemove ?? (() => {})}
        onResume={onFollowUpResume ?? (() => {})}
      />
      <SessionGroupEditorDialog
        description={sessionGroupDraftDescription}
        error={sessionGroupCreateError}
        mode="create"
        name={sessionGroupDraftName}
        open={sessionGroupEditorOpen}
        saving={sessionGroupSaving}
        onCancel={() => {
          setSessionGroupEditorOpen(false)
          setSessionGroupCreateError(null)
        }}
        onDescriptionChange={setSessionGroupDraftDescription}
        onNameChange={setSessionGroupDraftName}
        onSubmit={() => void createSessionGroup()}
      />
      <ConfirmationDialog
        actionLabel="确认归档"
        description="归档后可在设置中恢复此任务。"
        open={archiveConfirmationOpen}
        title="归档当前任务？"
        onAction={() => {
          setArchiveConfirmationOpen(false)
          onArchiveConversation?.()
        }}
        onCancel={() => setArchiveConfirmationOpen(false)}
      />
    </div>
  );
}

function parentWorkspacePath(path: string): string {
  const parts = path.replace(/\\/gu, '/').split('/').filter(Boolean)
  parts.pop()
  return parts.length > 0 ? parts.join('/') : '.'
}

function resolveWorkspaceContextPath(
  workspacePath: string,
  relativePath: string,
): string[] {
  if (relativePath === '.') return [workspacePath]
  const separator = workspacePath.includes('\\') ? '\\' : '/'
  return [`${workspacePath.replace(/[\\/]+$/u, '')}${separator}${relativePath.replace(/^[.][\\/]/u, '')}`]
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

function composerCommandMenuItem(
  command: ComposerCommand,
  executeCommand: (command: ComposerSlashCommand) => Promise<void>,
  onSkillSelect: ((skill: ComposerSkillCommand) => void) | undefined,
): ComposerMenuItem {
  return {
    key:
      command.source === "skill"
        ? `skill-${command.trigger}`
        : `slash-${command.id}`,
    label: command.title,
    description: command.description,
    meta: command.source === 'skill' ? skillScopeLabel(command.skill.scope) : undefined,
    icon:
      command.source === "skill" ? (
        <BuiltinSkillIcon skill={command.skill} size={14} />
      ) : (
        composerSlashCommandIcon(command.id)
      ),
    command,
    matchText: `${command.trigger} ${command.title} ${command.description}`,
    disabled:
      command.source === "builtin" && !command.availability.enabled,
    disabledReason:
      command.source === 'builtin' ? command.availability.disabledReason : undefined,
    onSelect: () => {
      if (command.source === "skill") {
        onSkillSelect?.(command);
        return;
      }
      void executeCommand(command);
    },
  };
}

function composerSlashCommandIcon(
  id: ComposerSlashCommandId,
): React.ReactNode {
  switch (id) {
    case "model":
      return <Box size={14} />;
    case "reasoning":
      return <Brain size={14} />;
    case "plan":
      return <ListChecks size={14} />;
    case "goal":
      return <Target size={14} />;
    case "review":
      return <ShieldCheck size={14} />;
    case "compact":
      return <Zap size={14} />;
    case "mcp":
      return <Paperclip size={14} />;
    case "status":
      return <Activity size={14} />;
    case "side":
      return <MessageSquarePlus size={14} />;
    case "fork":
      return <GitFork size={14} />;
    case "archive":
      return <Archive size={14} />;
    case "project":
      return <Folder size={14} />;
    case "task":
      return <MessageSquare size={14} />;
  }
}

export function shouldSubmitComposerKey(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing" | "keyCode"
  >,
  shortcut: ComposerSubmitShortcut,
  input: string,
): boolean {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.isComposing ||
    event.keyCode === 229
  ) {
    return false;
  }
  const modifierPressed = event.ctrlKey || event.metaKey;
  if (shortcut === "ctrl-enter") return modifierPressed;
  if (shortcut === "multiline-ctrl-enter" && input.includes("\n")) {
    return modifierPressed;
  }
  return true;
}

export function resolveComposerSubmitIntent(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing" | "keyCode"
  >,
  shortcut: ComposerSubmitShortcut,
  input: string,
): ComposerDeliveryIntent | null {
  if (!shouldSubmitComposerKey(event, shortcut, input)) return null;
  return event.ctrlKey || event.metaKey ? "follow-up" : "default";
}

function firstEnabledMenuIndex(items: ComposerMenuItem[]): number {
  return items.findIndex((item) => !item.disabled);
}

function lastEnabledMenuIndex(items: ComposerMenuItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

function nextEnabledMenuIndex(
  items: ComposerMenuItem[],
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
  if (atIndex > 0 && !/\s/u.test(input[atIndex - 1] ?? '')) return null;
  const query = textBefore.slice(atIndex + 1);
  if (query.includes(" ")) return null;
  // Cursor must be at end of query — no valid mention chars immediately after
  const charAfterCursor = input[selectionStart];
  if (charAfterCursor && /[a-zA-Z0-9\u4e00-\u9fff-]/.test(charAfterCursor)) {
    return null;
  }
  return { start: atIndex, end: selectionStart, query };
}
