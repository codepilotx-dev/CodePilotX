import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  CircleUser,
  Download,
  Gauge,
  LogOut,
  Send,
  Settings2,
  Smartphone,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { desktopClient } from '../../../services/desktopClient.js'
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
import { motionTransition, standardTween } from '../../motion/motionTransitions.js'
import type {
  DesktopModelProviderState,
  DesktopProviderBalanceResult,
  DesktopProviderTokenPlanUsageInfo,
  DesktopUpdateStatus,
  ModelProviderID,
} from '../../../../shared/types.js'
import { IconButton } from "../../../components/ui/IconButton.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { SidebarRow } from "./SidebarRow.js";
import { isBillingProviderID } from '../../../utils/billingProviders.js'
import { formatRemainingWindow, formatDuration, clampPercent } from '../../../utils/providerBalanceUtils.js'

type PopoverUsageRow = {
  label: string;
  percent: number;
  detail: string;
};

type ProviderUsageState = {
  providerID: ModelProviderID | null;
  displayName: string | null;
  balance: DesktopProviderBalanceResult | null;
  modelConfigured: boolean;
  loading: boolean;
  error: string | null;
};

const EMPTY_USAGE: ProviderUsageState = {
  providerID: null,
  displayName: null,
  balance: null,
  modelConfigured: false,
  loading: false,
  error: null,
};

export function SidebarFooter(): React.ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const reducedMotion = usePrefersReducedMotion()
  const [usage, setUsage] = useState<ProviderUsageState>(EMPTY_USAGE);
  const settingsActive = location.pathname === "/settings";
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null)

  useEffect(() => {
    const unsubscribe = desktopClient.onUpdateStatusChange(setUpdateStatus)
    return unsubscribe
  }, [])

  const refreshUsage = useCallback(async (): Promise<void> => {
    setUsage(previous => ({ ...previous, loading: true, error: null }));
    try {
      const providerState = await desktopClient.getModelProviderState();
      const providerID = providerState.selectedProviderID;
      if (!isBillingProviderID(providerID) || !providerState.apiKeyConfigured) {
        setUsage({
          providerID,
          modelConfigured: providerState.modelConfigured,
          displayName: providerState.provider.displayName,
          balance: null,
          loading: false,
          error: null,
        });
        return;
      }
      const balance = await desktopClient.fetchProviderBalance({ providerID });
      setUsage({
        providerID,
        modelConfigured: providerState.modelConfigured,
        displayName: providerState.provider.displayName,
        balance,
        loading: false,
        error: balance.error ?? null,
      });
    } catch (fetchError) {
      setUsage(previous => ({
        ...previous,
        modelConfigured: previous.modelConfigured,
        loading: false,
        error:
          fetchError instanceof Error
            ? fetchError.message
            : String(fetchError),
      }));
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    void refreshUsage();
  }, [menuOpen, refreshUsage]);

  const usageRows = useMemo<PopoverUsageRow[]>(
    () => buildUsageRows(usage),
    [usage],
  );

  return (
    <footer className="sidebar-footer">
      <PopoverMenu
        className="popover-sidebar-footer"
        open={menuOpen}
        side="top"
        width={300}
        maxWidth={300}
        trigger={
          <SidebarRow
            active={settingsActive}
            asChild
            className="sidebar-settings-link"
            labelClassName="sidebar-settings-label"
            leading={
              <span className="sidebar-settings-icon-wrap">
                <Settings2 size={APP_ICON_SIZE} />
                {updateStatus?.phase === 'available' ? (
                  <span className="sidebar-update-dot" />
                ) : null}
              </span>
            }
          >
            <button className="sidebar-footer-trigger" type="button">
              设置
            </button>
          </SidebarRow>
        }
        onOpenChange={setMenuOpen}
      >
        <div className="popover-section">
          <PopoverItem
            icon={<CircleUser size={APP_ICON_SIZE} />}
            onClick={() => {
              setMenuOpen(false);
              navigate("/settings?tab=profile");
            }}
          >
            个人资料
          </PopoverItem>
          <PopoverItem
            active={settingsActive}
            icon={<Settings2 size={APP_ICON_SIZE} />}
            shortcut="Ctrl+,"
            onClick={() => {
              setMenuOpen(false);
              navigate("/settings");
            }}
          >
            设置
          </PopoverItem>
          <PopoverItem
            icon={<Send size={APP_ICON_SIZE} />}
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            邀请好友
          </PopoverItem>
        </div>
        <div className="popover-divider" />
        <div className="popover-section">
          {isBillingProviderID(usage.providerID) && usage.modelConfigured ? (
            <>
              <PopoverItem
                icon={<Gauge size={APP_ICON_SIZE} />}
                withArrow
                arrowDirection={usageExpanded ? "up" : "down"}
                keepOpen
                onClick={() => setUsageExpanded(prev => !prev)}
              >
                剩余用量
              </PopoverItem>
              <AnimatePresence initial={false}>
                {usageExpanded ? (
                  <motion.div
                    animate={{ height: "auto", opacity: 1, y: 0 }}
                    className="popover-usage-panel"
                    exit={{ height: 0, opacity: 0, y: -4 }}
                    initial={{ height: 0, opacity: 0, y: -4 }}
                    key="usage-panel"
                    transition={motionTransition(reducedMotion, standardTween)}
                  >
                    <div className="popover-usage-header">
                      <span className="popover-usage-header-name">
                        {usage.displayName ?? "当前模型"}
                      </span>
                    </div>
                    {usageRows.length > 0 ? (
                      usageRows.map(row => (
                        <div className="popover-usage-row" key={row.label}>
                          <span className="popover-usage-label">{row.label}</span>
                          <span className="popover-usage-track">
                            <span
                              className="popover-usage-fill"
                              style={
                                {
                                  '--usage-ratio': row.percent / 100,
                                } as React.CSSProperties
                              }
                            />
                          </span>
                          <span className="popover-usage-percent">
                            {row.percent}%
                          </span>
                          <span className="popover-usage-detail">{row.detail}</span>
                        </div>
                      ))
                    ) : usage.loading ? (
                      <div className="popover-usage-empty">正在查询用量…</div>
                    ) : usage.error ? (
                      <div className="popover-usage-empty popover-usage-empty-error">
                        {usage.error}
                      </div>
                    ) : (
                      <div className="popover-usage-empty">
                        当前提供商未返回用量数据
                      </div>
                    )}
                    <div className="popover-usage-divider" />
                    <button
                      className="popover-usage-action"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/settings?tab=billing");
                      }}
                      type="button"
                    >
                      <span className="popover-usage-action-label">了解更多</span>
                      <ArrowUpRight
                        className="popover-usage-action-icon"
                        size={APP_ICON_SIZE}
                      />
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>
          ) : null}
          {(updateStatus?.phase === 'available' ||
            updateStatus?.phase === 'downloading' ||
            updateStatus?.phase === 'downloaded') ? (
            <PopoverItem
              icon={<Download size={APP_ICON_SIZE} />}
              onClick={() => {
                if (updateStatus.phase === 'downloaded') {
                  void desktopClient.quitAndInstall()
                } else if (updateStatus.phase === 'available') {
                  void desktopClient.downloadUpdate()
                }
              }}
            >
              {updateStatus.phase === 'downloaded'
                ? '重启安装'
                : updateStatus.phase === 'downloading'
                  ? `下载中 ${Math.round(updateStatus.percent)}%`
                  : '安装更新'}
            </PopoverItem>
          ) : null}
          <PopoverItem
            icon={<LogOut size={APP_ICON_SIZE} />}
            onClick={() => {
              setMenuOpen(false);
              void desktopClient.logOut();
            }}
          >
            退出登录
          </PopoverItem>
        </div>
      </PopoverMenu>
      <IconButton
        className="icon-button sidebar-mobile-button"
        onClick={() => {}}
        title="移动端"
      >
        <Smartphone size={APP_ICON_SIZE} />
      </IconButton>
    </footer>
  );
}

function buildUsageRows(usage: ProviderUsageState): PopoverUsageRow[] {
  const { balance } = usage;
  if (!balance) return [];
  const providerID = usage.providerID;
  if (providerID === "minimax") {
    return buildMiniMaxRows(balance.tokenPlanUsages ?? []);
  }
  if (providerID === "deepseek") {
    return buildDeepSeekRows(balance.balances);
  }
  return [];
}

function buildMiniMaxRows(
  usages: DesktopProviderTokenPlanUsageInfo[],
): PopoverUsageRow[] {
  const primary = usages.find(item => item.modelName === "general") ?? usages[0];
  if (!primary) return [];
  const rows: PopoverUsageRow[] = [];
  const intervalPercent = primary.currentIntervalRemainingPercent ?? 0;
  rows.push({
    label: "5 小时",
    percent: clampPercent(intervalPercent),
    detail: formatRemainingWindow(
      primary.currentIntervalRemainingTime,
      primary.currentIntervalEndTime,
    ),
  });
  if (primary.currentWeeklyRemainingPercent != null) {
    rows.push({
      label: "1 周",
      percent: clampPercent(primary.currentWeeklyRemainingPercent),
      detail: formatRemainingWindow(
        primary.weeklyRemainingTime,
        primary.weeklyEndTime,
      ),
    });
  }
  return rows;
}

function buildDeepSeekRows(
  balances: DesktopProviderBalanceResult["balances"],
): PopoverUsageRow[] {
  if (balances.length === 0) return [];
  return balances.map(item => ({
    label: item.currency,
    percent: 100,
    detail: `余额 ${item.totalBalance}`,
  }));
}

