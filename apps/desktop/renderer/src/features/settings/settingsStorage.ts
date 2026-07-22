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
    detail: "在主机运行；安全操作快速放行，其余由 Guardian 审核，高风险需你确认。",
  },
  {
    value: "auto-review",
    label: "自动审查",
    detail: "在主机运行；安全操作快速放行，其余由 Guardian 自动审核，高风险需你确认。",
  },
  {
    value: "full-access",
    label: "完全访问权限",
    detail: "命令不受 SRT 文件和网络边界保护，仅由审核 agent 拒绝灾难级操作（风险很高）",
  },
  {
    value: "custom",
    label: "CodePilotX 自定义策略",
    detail: "自定义 SRT 隔离、approval policy、reviewer 与 granular controls。",
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
    if (option.value === "auto-review") return enableAutoReviewPermissionMode !== false;
    if (option.value === "full-access") return enableFullAccessPermissionMode !== false;
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
  if (config.sandboxMode === 'danger-full-access' && config.approvalPolicy === 'on-request' && config.approvalsReviewer === 'auto_review') return 'auto-review'
  if (config.sandboxMode === 'danger-full-access' && config.approvalPolicy === 'on-request' && config.approvalsReviewer === 'user') return 'default'
  return 'custom'
}

export function permissionConfigForMode(mode: DesktopPermissionMode): DesktopPermissionConfig {
  if (mode === 'full-access') return { sandboxMode: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'auto_review' }
  return { sandboxMode: 'danger-full-access', approvalPolicy: 'on-request', approvalsReviewer: mode === 'auto-review' ? 'auto_review' : 'user' }
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
