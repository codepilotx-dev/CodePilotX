import { desktopClient } from '../../services/desktopClient.js'
import type {
  DesktopPermissionConfig,
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
  {
    value: "custom",
    label: "CodePilotX 自定义策略",
    detail: "使用配置页中的 sandbox、approval policy、reviewer 与 granular controls。",
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
    return option.value === "default" || option.value === "custom";
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

export function permissionModeForConfig(config: DesktopPermissionConfig): DesktopPermissionMode {
  if (config.sandboxMode === 'danger-full-access' && config.approvalPolicy === 'never') return 'full-access'
  if (config.sandboxMode === 'workspace-write' && config.approvalPolicy === 'on-request' && config.approvalsReviewer === 'auto_review') return 'auto-review'
  if (config.sandboxMode === 'workspace-write' && config.approvalPolicy === 'on-request' && config.approvalsReviewer === 'user') return 'default'
  return 'custom'
}

export function permissionConfigForMode(mode: DesktopPermissionMode): DesktopPermissionConfig {
  if (mode === 'full-access') return { sandboxMode: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' }
  return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: mode === 'auto-review' ? 'auto_review' : 'user' }
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
