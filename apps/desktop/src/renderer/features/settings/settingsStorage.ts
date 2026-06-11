import type { DrawerTab } from "../../uiTypes.js";
import type {
  DesktopPermissionMode,
  DesktopStoredSettings,
  DesktopThinkingMode,
  DesktopWorkspace,
  ModelProviderID,
} from "../../../shared/types.js";

export const PERMISSION_MODE_OPTIONS: Array<{
  value: DesktopPermissionMode;
  label: string;
  detail: string;
}> = [
  {
    value: "default",
    label: "默认权限",
    detail: "Codex 在沙盒中自动运行命令。",
  },
  {
    value: "acceptEdits",
    label: "自动审查",
    detail:
      "Codex 将在沙盒中运行命令，并对需升级处理的请求进行自动审查。了解更多",
  },
  {
    value: "bypassPermissions",
    label: "完全访问权限",
    detail: "Codex 对你的计算机拥有完全访问权限（风险升高）",
  },
  {
    value: "dontAsk",
    label: "自定义（config.toml）",
    detail: "Codex 使用 config.toml 中定义的权限",
  },
];

export const THINKING_MODE_OPTIONS: Array<{
  value: DesktopThinkingMode;
  label: string;
}> = [
  { value: "disabled", label: "低" },
  { value: "default", label: "中" },
  { value: "adaptive", label: "高" },
  { value: "enabled", label: "超高" },
];

export const DESKTOP_SETTINGS_STORAGE_KEY = "claude-code-desktop-settings";
export const MAX_RECENT_WORKSPACES = 5;

export type StoredDesktopSettings = DesktopStoredSettings;

export function defaultDesktopSettings(): StoredDesktopSettings {
  return {
    permissionMode: "default",
    model: "",
    fallbackModel: "",
    sessionName: "",
    thinkingMode: "default",
    systemPrompt: "",
    appendSystemPrompt: "",
    additionalDirectories: "",
    recentWorkspaces: [],
    drawerTab: "files",
    selectedModelPreset: "",
    providerID: "anthropic",
    providerBaseURL: "",
    showContextUsage: true,
    defaultOpenTargetId: "default-app",
  };
}

export function upsertRecentWorkspace(
  workspaces: DesktopWorkspace[],
  workspace: DesktopWorkspace,
): DesktopWorkspace[] {
  if (workspace.isStandalone) return workspaces;
  const filtered = workspaces.filter((item) => item.path !== workspace.path);
  return [workspace, ...filtered].slice(0, MAX_RECENT_WORKSPACES);
}

function isDesktopPermissionMode(
  value: unknown,
): value is DesktopPermissionMode {
  return PERMISSION_MODE_OPTIONS.some((option) => option.value === value);
}

function isDesktopThinkingMode(value: unknown): value is DesktopThinkingMode {
  return THINKING_MODE_OPTIONS.some((option) => option.value === value);
}

function isDrawerTab(value: unknown): value is DrawerTab {
  return (
    value === "files" ||
    value === "diff" ||
    value === "permissions" ||
    value === "toolLog" ||
    value === "settings"
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isModelProviderID(value: unknown): value is ModelProviderID {
  return typeof value === "string" && value.trim().length > 0;
}

function parseStoredRecentWorkspaces(value: unknown): DesktopWorkspace[] {
  if (!Array.isArray(value)) return [];
  const workspaces: DesktopWorkspace[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      (item as DesktopWorkspace).isStandalone !== true &&
      isString((item as DesktopWorkspace).name) &&
      isString((item as DesktopWorkspace).path)
    ) {
      workspaces.push({
        name: (item as DesktopWorkspace).name,
        path: (item as DesktopWorkspace).path,
        branchName:
          typeof (item as DesktopWorkspace).branchName === "string"
            ? (item as DesktopWorkspace).branchName
            : null,
        isGitRepo:
          typeof (item as DesktopWorkspace).isGitRepo === "boolean"
            ? (item as DesktopWorkspace).isGitRepo
            : undefined,
      });
    }
  }
  return workspaces;
}

export function readStoredDesktopSettings(): StoredDesktopSettings {
  return defaultDesktopSettings();
}

export function storeDesktopSettings(settings: StoredDesktopSettings): void {
  void window.desktopApi.saveDesktopSettings(settings);
}

export function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseAdditionalDirectories(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
