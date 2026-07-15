import { desktopClient } from '../../services/desktopClient.js'
import type {
  DesktopPermissionMode,
  DesktopStoredSettings,
  DesktopThinkingMode,
  LocalRouterMode,
} from "../../../shared/types.js";
import { defaultDesktopStoredSettings } from "../../../shared/settingsSchema.js";
export {
  MAX_RECENT_WORKSPACES,
  upsertRecentWorkspace,
} from "../../../shared/settingsSchema.js";
export type { LocalRouterMode } from "../../../shared/types.js"

export const PERMISSION_MODE_OPTIONS: Array<{
  value: DesktopPermissionMode;
  label: string;
  detail: string;
}> = [
  {
    value: "default",
    label: "默认权限",
    detail: "CodePilotX 可自动读取；写入、命令、联网和 MCP 请求需要你授权。",
  },
  {
    value: "auto-review",
    label: "自动审查",
    detail:
      "CodePilotX 将在沙盒中运行命令，并对需升级处理的请求进行自动审查。了解更多",
  },
  {
    value: "full-access",
    label: "完全访问权限",
    detail: "命令不受 SRT 文件和网络边界保护，仅由审核 agent 拒绝灾难级操作（风险很高）",
  },
];

export function getVisiblePermissionModeOptions({
  enableAutoReviewPermissionMode,
  enableFullAccessPermissionMode,
}: {
  enableAutoReviewPermissionMode?: boolean;
  enableFullAccessPermissionMode?: boolean;
}): typeof PERMISSION_MODE_OPTIONS {
  return PERMISSION_MODE_OPTIONS.filter((option) => {
    if (option.value === "auto-review") return enableAutoReviewPermissionMode;
    if (option.value === "full-access") return enableFullAccessPermissionMode;
    return option.value === "default";
  });
}

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

export type StoredDesktopSettings = DesktopStoredSettings;

export function defaultDesktopSettings(): StoredDesktopSettings {
  return defaultDesktopStoredSettings();
}

export function readStoredDesktopSettings(): StoredDesktopSettings {
  return defaultDesktopSettings();
}

export function storeDesktopSettings(settings: StoredDesktopSettings): void {
  void desktopClient.saveDesktopSettings(settings);
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
