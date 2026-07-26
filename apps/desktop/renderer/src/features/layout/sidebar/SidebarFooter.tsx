import type React from "react";
import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowUpRight,
  ChevronRight,
  CircleUser,
  Download,
  Gauge,
  Ghost,
  HelpCircle,
  Keyboard,
  LogOut,
  Settings2,
} from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { buildPopoverSizingStyle } from '../../../components/ui/popoverSizing.js'
import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type {
  DesktopGithubUser,
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
import { clampPercent, formatRemainingWindow } from '../../../utils/providerBalanceUtils.js'
import { cx } from '../../../utils/cx.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'

type PopoverUsageRow = {
  label: string;
  usage: string;
  reset: string;
};

type ProviderUsageState = {
  providerID: ModelProviderID | null;
  balance: DesktopProviderBalanceResult | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_USAGE: ProviderUsageState = {
  providerID: null,
  balance: null,
  loading: false,
  error: null,
};

type SidebarFooterProps = {
  sidebarWidth: number;
  onReport: (message: string) => void;
};

export const SidebarFooter = forwardRef<HTMLElement, SidebarFooterProps>(function SidebarFooter(
  { sidebarWidth, onReport },
  ref,
): React.ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    draft,
    model,
    providerID: configuredProviderID,
  } = useDesktopSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [usage, setUsage] = useState<ProviderUsageState>(EMPTY_USAGE);
  const [githubUser, setGithubUser] = useState<DesktopGithubUser | null>(null);
  const [petToggleBusy, setPetToggleBusy] = useState(false);
  const settingsActive = location.pathname.startsWith("/settings/");
  const usageAvailable =
    isBillingProviderID(configuredProviderID) && Boolean(model);
  const petEnabled = draft.values.pet.enabled;
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
          balance: null,
          loading: false,
          error: null,
        });
        return;
      }
      const balance = await desktopClient.fetchProviderBalance({ providerID });
      setUsage({
        providerID,
        balance,
        loading: false,
        error: balance.error ?? null,
      });
    } catch (fetchError) {
      setUsage(previous => ({
        ...previous,
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

  useEffect(() => {
    if (!menuOpen) return;

    let cancelled = false;
    void desktopClient
      .getGithubAuthStatus()
      .then(status => {
        if (!cancelled) {
          setGithubUser(status.authenticated ? status.user : null);
        }
      })
      .catch(() => {
        if (!cancelled) setGithubUser(null);
      });

    return () => {
      cancelled = true;
    };
  }, [menuOpen]);

  const togglePet = useCallback(async (): Promise<void> => {
    if (petToggleBusy) return;
    const nextEnabled = !petEnabled;
    setPetToggleBusy(true);
    try {
      const bridge = window.codePilotXDesktop;
      if (nextEnabled) {
        if (typeof bridge?.openPetOverlay !== "function") {
          throw new Error("宠物浮窗暂不可用");
        }
        await bridge.openPetOverlay();
      } else {
        if (typeof bridge?.hidePetOverlay !== "function") {
          throw new Error("宠物浮窗暂不可用");
        }
        await bridge.hidePetOverlay();
      }
      draft.setValue('pet', current => ({
        ...current,
        enabled: nextEnabled,
      }));
      draft.autoSave();
    } catch (error) {
      onReport(error instanceof Error ? error.message : String(error));
    } finally {
      setPetToggleBusy(false);
    }
  }, [draft, onReport, petEnabled, petToggleBusy]);

  const usageRows = useMemo<PopoverUsageRow[]>(
    () => buildUsageRows(usage),
    [usage],
  );
  const accountName = githubUser?.name || githubUser?.login || "个人资料";
  return (
    <footer
      className="sidebar-footer tw:mt-2 tw:flex tw:w-full tw:shrink-0 tw:items-center tw:gap-1 tw:px-1.5"
      ref={ref}
    >
      <PopoverMenu
        className="popover-sidebar-footer"
        open={menuOpen}
        side="top"
        width={Math.max(0, sidebarWidth - 12)}
        maxWidth="calc(100vw - 16px)"
        trigger={
          <SidebarRow
            active={settingsActive}
            asChild
            className="sidebar-settings-link"
            labelClassName={cx('sidebar-settings-label', 'u-min-w-0', 'u-truncate')}
            leading={
              <span className="sidebar-settings-icon-wrap">
                <Settings2 aria-hidden="true" size={APP_ICON_SIZE} />
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
          <div className="popover-account-row">
            <PopoverItem
              icon={
                <span className="popover-account-avatar" aria-hidden="true">
                  {githubUser?.avatarUrl ? (
                    <RemoteImage
                      alt=""
                      fallback={<CircleUser size={APP_ICON_SIZE} />}
                      src={githubUser.avatarUrl}
                    />
                  ) : (
                    <CircleUser size={APP_ICON_SIZE} />
                  )}
                </span>
              }
              onClick={() => {
                setMenuOpen(false);
                navigate("/settings/profile");
              }}
            >
              {accountName}
            </PopoverItem>
          </div>
        </div>
        <div className="popover-divider" />
        <div className="popover-section">
          {usageAvailable ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger
                className="popover-item popover-sub-trigger"
                tabIndex={-1}
              >
                <span className="popover-item-leading">
                  <span className="popover-item-icon">
                    <Gauge size={APP_ICON_SIZE} />
                  </span>
                </span>
                <span className="popover-item-label">剩余用量</span>
                <span className="popover-item-trailing">
                  <ChevronRight
                    className="popover-item-arrow"
                    size={APP_ICON_SIZE}
                  />
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  alignOffset={-6}
                  aria-label="剩余用量详情"
                  className="popover-surface popover popover-sub-content popover-usage-submenu"
                  sideOffset={16}
                  style={buildPopoverSizingStyle({
                    width: 300,
                    maxWidth: "calc(100vw - 16px)",
                  })}
                >
                  <div className="popover-usage-content">
                    {usage.loading ? (
                      <div className="popover-usage-empty" role="status">
                        正在查询用量…
                      </div>
                    ) : usage.error ? (
                      <div
                        className="popover-usage-empty popover-usage-empty-error"
                        role="status"
                      >
                        {usage.error}
                      </div>
                    ) : usageRows.length > 0 ? (
                      <div
                        aria-label="额度明细"
                        className="popover-usage-rows"
                        role="group"
                      >
                        {usageRows.map(row => (
                          <div className="popover-usage-row" key={row.label}>
                            <span className="popover-usage-label">{row.label}</span>
                            <span className="popover-usage-value">
                              <span className="popover-usage-amount">
                                {row.usage}
                              </span>
                              {row.reset ? (
                                <span className="popover-usage-reset">
                                  {row.reset}
                                </span>
                              ) : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="popover-usage-empty" role="status">
                        当前提供商未返回用量数据
                      </div>
                    )}
                    <div className="popover-usage-divider" />
                    <DropdownMenu.Item
                      className="popover-usage-action"
                      tabIndex={-1}
                      onSelect={() => {
                        setMenuOpen(false);
                        navigate("/settings/billing");
                      }}
                    >
                      <span
                        className={cx(
                          'popover-usage-action-label',
                          'u-flex-1',
                          'u-min-w-0',
                          'u-truncate',
                        )}
                      >
                        了解更多
                      </span>
                      <ArrowUpRight
                        className="popover-usage-action-icon"
                        size={APP_ICON_SIZE}
                      />
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : null}
          <PopoverItem
            disabled={petToggleBusy}
            icon={<Ghost size={APP_ICON_SIZE} />}
            onClick={() => {
              void togglePet();
            }}
          >
            {petEnabled ? "隐藏宠物" : "显示宠物"}
          </PopoverItem>
          <PopoverItem
            active={settingsActive}
            icon={<Settings2 size={APP_ICON_SIZE} />}
            shortcut="Ctrl+,"
            onClick={() => {
              setMenuOpen(false);
              navigate("/settings/general");
            }}
          >
            设置
          </PopoverItem>
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
      <PopoverMenu
        align="end"
        className="popover-sidebar-help"
        open={helpMenuOpen}
        side="top"
        width={190}
        trigger={
          <IconButton
            className="sidebar-help-button"
            title="帮助"
          >
            <HelpCircle size={APP_ICON_SIZE} />
          </IconButton>
        }
        onOpenChange={setHelpMenuOpen}
      >
        <PopoverItem
          icon={<Keyboard size={APP_ICON_SIZE} />}
          onClick={() => {
            setHelpMenuOpen(false)
            navigate('/settings/shortcuts')
          }}
        >
          键盘快捷键
        </PopoverItem>
        <PopoverItem
          icon={<Settings2 size={APP_ICON_SIZE} />}
          onClick={() => {
            setHelpMenuOpen(false)
            navigate('/settings/general')
          }}
        >
          帮助与设置
        </PopoverItem>
      </PopoverMenu>
    </footer>
  );
});

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
  const rows: PopoverUsageRow[] = [
    {
      label: "5 小时",
      usage: formatUsageValue(
        primary.currentIntervalRemainingPercent,
        primary.currentIntervalRemainingCount,
        primary.currentIntervalTotalCount,
      ),
      reset: formatRemainingWindow(
        primary.currentIntervalRemainingTime,
        primary.currentIntervalEndTime,
      ),
    },
  ];
  if (
    primary.currentWeeklyRemainingPercent != null ||
    primary.currentWeeklyRemainingCount != null ||
    primary.currentWeeklyTotalCount != null ||
    primary.weeklyRemainingTime != null ||
    primary.weeklyEndTime != null
  ) {
    rows.push({
      label: "1 周",
      usage: formatUsageValue(
        primary.currentWeeklyRemainingPercent,
        primary.currentWeeklyRemainingCount,
        primary.currentWeeklyTotalCount,
      ),
      reset: formatRemainingWindow(
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
    usage: `余额 ${item.totalBalance}`,
    reset: "",
  }));
}

function formatUsageValue(
  remainingPercent: number | null,
  remainingCount: number | null,
  totalCount: number | null,
): string {
  const parts: string[] = [];
  if (remainingPercent != null) {
    parts.push(`${clampPercent(remainingPercent)}%`);
  }
  const count = formatCountPair(remainingCount, totalCount);
  if (count !== "—") parts.push(count);
  return parts.join(" · ") || "—";
}

function formatCountPair(
  remaining: number | null,
  total: number | null,
): string {
  if (remaining == null && (total == null || total <= 0)) return "—";
  const remainingText =
    remaining == null ? "—" : new Intl.NumberFormat("zh-CN").format(remaining);
  if (total == null || total <= 0) return remainingText;
  return `${remainingText} / ${new Intl.NumberFormat("zh-CN").format(total)}`;
}

