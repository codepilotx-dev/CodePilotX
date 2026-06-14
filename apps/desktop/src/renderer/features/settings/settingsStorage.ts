import { desktopClient } from '../../services/desktopClient.js'
import type {
  DesktopPermissionMode,
  DesktopStoredSettings,
  DesktopThinkingMode,
} from "../../../shared/types.js";
import { defaultDesktopStoredSettings } from "../../../shared/settingsSchema.js";
export {
  MAX_RECENT_WORKSPACES,
  upsertRecentWorkspace,
} from "../../../shared/settingsSchema.js";

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
    value: "auto",
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
    value: "customConfig",
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
