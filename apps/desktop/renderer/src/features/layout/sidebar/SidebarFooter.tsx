import type React from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ArrowUpRight,
  ChevronRight,
  CircleUser,
  Download,
  Gauge,
  HelpCircle,
  Keyboard,
  LogOut,
  PawPrint,
  Settings,
  Sparkles,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/iconTokens.js'
import { buildPopoverSizingStyle } from '../../../components/ui/popoverSizing.js'
import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { DesktopUpdateStatus, ModelProviderID } from '../../../../shared/types.js'
import { PopoverItem, PopoverSeparator } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SidebarRow } from './SidebarRow.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import {
  buildDesktopUpdateIndicatorModel,
  runDesktopUpdateIndicatorAction,
  startDesktopUpdateMonitoring,
} from './desktopUpdateMenu.js'
import {
  allBalances,
  criticalQuotaWindows,
  formatAmount,
  formatQuotaValue,
  protocolProviderId,
  sourceForProvider,
  type ProviderUsageSource,
} from '../../../utils/usageFormatters.js'
import { cx } from '../../../utils/cx.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'

type PopoverUsageRow = {
  id: string
  label: string
  usage: string
}

type ProviderUsageState = {
  providerID: ModelProviderID | null
  source: ProviderUsageSource | null
  loading: boolean
  error: string | null
}

const EMPTY_USAGE: ProviderUsageState = {
  providerID: null,
  source: null,
  loading: false,
  error: null,
}

type SidebarFooterProps = {
  compact?: boolean
  onNavigate?: () => void
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onReport: (message: string) => void
}

export const SidebarFooter = forwardRef<HTMLElement, SidebarFooterProps>(function SidebarFooter(
  { compact = false, onNavigate, onOpenWhatsNew, onReport },
  ref,
): React.ReactNode {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useLocale()
  const { draft, model, providerID: configuredProviderID } = useDesktopSettings()
  const [menuOpen, setMenuOpen] = useState(false)
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [usage, setUsage] = useState<ProviderUsageState>(EMPTY_USAGE)
  const { auth: githubAuth } = useSyncExternalStore(
    desktopClient.onGithubAccountChange,
    desktopClient.getGithubAccountSnapshot,
    desktopClient.getGithubAccountSnapshot,
  )
  const [petToggleBusy, setPetToggleBusy] = useState(false)
  const settingsActive = location.pathname.startsWith('/settings/')
  const usageAvailable = Boolean(configuredProviderID && model)
  const petEnabled = draft.values.pet.enabled
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null)
  const updateIndicator = buildDesktopUpdateIndicatorModel(updateStatus)

  useEffect(() => {
    return startDesktopUpdateMonitoring(desktopClient, setUpdateStatus)
  }, [])

  const refreshUsage = useCallback(async (): Promise<void> => {
    setUsage((previous) => ({ ...previous, loading: true, error: null }))
    try {
      const providerState = await desktopClient.getModelProviderState()
      const providerID = providerState.selectedProviderID
      if (!providerID || !providerState.apiKeyConfigured) {
        setUsage({
          providerID,
          source: null,
          loading: false,
          error: null,
        })
        return
      }
      const result = await desktopClient.queryProviderUsage({
        range: '7d',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        providerIds: [protocolProviderId(providerID)],
      })
      const source = sourceForProvider(result.sources, providerID) ?? null
      setUsage({
        providerID,
        source,
        loading: false,
        error: source?.error?.message ?? null,
      })
    } catch (fetchError) {
      setUsage((previous) => ({
        ...previous,
        loading: false,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      }))
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    void refreshUsage()
  }, [menuOpen, refreshUsage])

  const refreshGithubAuth = useCallback(async (): Promise<void> => {
    try {
      await desktopClient.getGithubAuthStatus()
    } catch {
      // 保留已有账户信息，下一次打开菜单时重试。
    }
  }, [])

  useEffect(() => {
    void refreshGithubAuth()
  }, [refreshGithubAuth])

  useEffect(() => {
    if (menuOpen) void refreshGithubAuth()
  }, [menuOpen, refreshGithubAuth])

  const logoutGithub = useCallback(async (): Promise<void> => {
    try {
      await desktopClient.logoutGithub()
    } catch (error) {
      onReport(error instanceof Error ? error.message : String(error))
    }
  }, [onReport])

  const togglePet = useCallback(async (): Promise<void> => {
    if (petToggleBusy) return
    const nextEnabled = !petEnabled
    setPetToggleBusy(true)
    try {
      const bridge = window.codePilotXDesktop
      if (nextEnabled) {
        if (typeof bridge?.openPetOverlay !== 'function') {
          throw new Error('宠物浮窗暂不可用')
        }
        await bridge.openPetOverlay()
      } else {
        if (typeof bridge?.hidePetOverlay !== 'function') {
          throw new Error('宠物浮窗暂不可用')
        }
        await bridge.hidePetOverlay()
      }
      draft.setValue('pet', (current) => ({
        ...current,
        enabled: nextEnabled,
      }))
      draft.autoSave()
    } catch (error) {
      onReport(error instanceof Error ? error.message : String(error))
    } finally {
      setPetToggleBusy(false)
    }
  }, [draft, onReport, petEnabled, petToggleBusy])

  const usageRows = useMemo<PopoverUsageRow[]>(() => buildUsageRows(usage), [usage])
  const githubAuthenticated = githubAuth?.authenticated === true
  const githubUser = githubAuthenticated ? githubAuth.user : null
  const accountName = githubUser?.name || githubUser?.login || t('个人资料')
  const accountTriggerName = compact || githubAuthenticated ? accountName : t('设置')
  const openSettings = (path: string): void => {
    setMenuOpen(false)
    onNavigate?.()
    navigate(path)
  }

  return (
    <footer
      className={`sidebar-footer tw:flex tw:w-full tw:shrink-0 tw:items-center${compact ? ' sidebar-footer--rail' : ''}`}
      ref={ref}
    >
      <PopoverMenu
        className="popover-menu--grid"
        open={menuOpen}
        side={compact ? 'right' : 'top'}
        align="end"
        width={200}
        maxWidth="calc(100vw - 16px)"
        trigger={
          <SidebarRow
            active={settingsActive || menuOpen}
            ref={accountMenuTriggerRef}
            asChild
            className="sidebar-settings-link"
            labelClassName={cx('sidebar-settings-label', 'u-min-w-0')}
            layout="flex"
            leading={
              <span className="sidebar-account-avatar" aria-hidden="true">
                {!githubAuthenticated ? (
                  compact ? (
                    <CircleUser data-icon-kind="artwork" size={14} />
                  ) : (
                    <Settings data-icon-kind="artwork" size={14} />
                  )
                ) : githubUser?.avatarUrl ? (
                  <RemoteImage
                    alt=""
                    fallback={<CircleUser data-icon-kind="artwork" size={14} />}
                    src={githubUser.avatarUrl}
                  />
                ) : (
                  <CircleUser data-icon-kind="artwork" size={14} />
                )}
                {updateIndicator.visible ? (
                  <span className="sidebar-account-update-dot" aria-hidden="true" />
                ) : null}
              </span>
            }
          >
            <button
              aria-label={
                updateIndicator.visible
                  ? `${accountTriggerName}，${t(updateIndicator.ariaLabel)}`
                  : accountTriggerName
              }
              className="sidebar-footer-trigger"
              type="button"
            >
              <span className={compact ? 'u-sr-only' : undefined}>{accountTriggerName}</span>
            </button>
          </SidebarRow>
        }
        onOpenChange={setMenuOpen}
      >
        <div className="popover-section">
          <PopoverItem
            icon={
              <span className="popover-account-avatar" aria-hidden="true">
                {githubUser?.avatarUrl ? (
                  <RemoteImage
                    alt=""
                    fallback={<CircleUser data-icon-kind="artwork" size={14} />}
                    src={githubUser.avatarUrl}
                  />
                ) : (
                  <CircleUser data-icon-kind="artwork" size={14} />
                )}
              </span>
            }
            description={
              githubAuthenticated
                ? githubUser?.name && githubUser.name !== githubUser.login
                  ? `@${githubUser.login}`
                  : t('GitHub 账户')
                : t('未登录')
            }
            onClick={() =>
              openSettings(githubAuthenticated ? '/settings/profile' : '/settings/git')
            }
          >
            {accountName}
          </PopoverItem>
        </div>
        <PopoverSeparator />
        <div className="popover-section">
          {usageAvailable ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="popover-item popover-sub-trigger" tabIndex={-1}>
                <span className="popover-item-leading">
                  <span className="popover-item-icon">
                    <Gauge size={APP_ICON_SIZE} />
                  </span>
                </span>
                <span className="popover-item-label">{t('剩余用量')}</span>
                <span className="popover-item-trailing">
                  <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZES.sm} />
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  data-theme-component="dropdown-surface"
                  alignOffset={-4}
                  aria-label={t('剩余用量详情')}
                  className="popover-surface popover popover-sub-content popover-usage-submenu"
                  collisionPadding={6}
                  sideOffset={4}
                  style={buildPopoverSizingStyle({
                    width: 280,
                    maxWidth: 'calc(100vw - 16px)',
                  })}
                >
                  <div className="popover-usage-content">
                    {usage.loading ? (
                      <div className="popover-usage-empty" role="status">
                        {t('正在查询用量…')}
                      </div>
                    ) : usage.error ? (
                      <div className="popover-usage-empty popover-usage-empty-error" role="status">
                        {usage.error}
                      </div>
                    ) : usageRows.length > 0 ? (
                      <div aria-label={t('额度明细')} className="popover-usage-rows" role="group">
                        {usageRows.map((row) => (
                          <div className="popover-usage-row" key={row.id}>
                            <span className="popover-usage-label">{row.label}</span>
                            <span className="popover-usage-value">
                              <span className="popover-usage-amount">{row.usage}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="popover-usage-empty" role="status">
                        {t('当前提供商未返回用量数据')}
                      </div>
                    )}
                    <div className="popover-usage-divider" />
                    <DropdownMenu.Item
                      className="popover-usage-action"
                      tabIndex={-1}
                      onSelect={() => {
                        openSettings('/settings/billing')
                      }}
                    >
                      <span className={cx('popover-usage-action-label', 'u-flex-1', 'u-min-w-0')}>
                        {t('了解更多')}
                      </span>
                      <ArrowUpRight className="popover-usage-action-icon" size={APP_ICON_SIZE} />
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : null}
          <PopoverItem
            disabled={petToggleBusy}
            icon={<PawPrint size={APP_ICON_SIZE} />}
            onClick={() => {
              void togglePet()
            }}
          >
            {t(petEnabled ? '隐藏宠物' : '显示宠物')}
          </PopoverItem>
          <PopoverItem
            active={settingsActive}
            icon={<Settings size={APP_ICON_SIZE} />}
            shortcut="Ctrl+,"
            onClick={() => openSettings('/settings/general')}
          >
            {t('设置')}
          </PopoverItem>
        </div>
        <PopoverSeparator />
        <div className="popover-section">
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="popover-item popover-sub-trigger" tabIndex={-1}>
              <span className="popover-item-leading">
                <span className="popover-item-icon">
                  <HelpCircle size={APP_ICON_SIZE} />
                </span>
              </span>
              <span className="popover-item-label">{t('帮助')}</span>
              <span className="popover-item-trailing">
                <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZES.sm} />
              </span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                data-theme-component="dropdown-surface"
                aria-label={t('帮助')}
                className="popover-surface popover popover-sub-content popover-menu--grid"
                collisionPadding={6}
                sideOffset={4}
                style={buildPopoverSizingStyle({ width: 200, maxWidth: 'calc(100vw - 16px)' })}
              >
                <PopoverItem
                  icon={<Sparkles size={APP_ICON_SIZE} />}
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenWhatsNew(accountMenuTriggerRef.current)
                  }}
                >
                  {t('新特性')}
                </PopoverItem>
                <PopoverItem
                  icon={<Keyboard size={APP_ICON_SIZE} />}
                  onClick={() => openSettings('/settings/shortcuts')}
                >
                  {t('键盘快捷键')}
                </PopoverItem>
                <PopoverItem
                  icon={<Download size={APP_ICON_SIZE} />}
                  description={updateIndicator.visible ? t(updateIndicator.ariaLabel) : undefined}
                  disabled={updateIndicator.disabled}
                  onClick={() => {
                    void runDesktopUpdateIndicatorAction(
                      desktopClient,
                      updateIndicator.action ?? 'check',
                    ).catch(() => {
                      setUpdateStatus({ phase: 'error', message: '更新操作失败，请稍后重试' })
                    })
                  }}
                >
                  {t(updateIndicator.visible ? updateIndicator.label : '检查更新')}
                </PopoverItem>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          {githubAuthenticated ? (
            <PopoverItem
              icon={<LogOut size={APP_ICON_SIZE} />}
              onClick={() => {
                setMenuOpen(false)
                void logoutGithub()
              }}
            >
              {t('退出登录')}
            </PopoverItem>
          ) : null}
        </div>
      </PopoverMenu>
      <span aria-atomic="true" aria-live="polite" className="u-sr-only">
        {t(updateIndicator.announcement)}
      </span>
    </footer>
  )
})

function buildUsageRows(usage: ProviderUsageState): PopoverUsageRow[] {
  const quotas = criticalQuotaWindows(usage.source, 3)
  if (quotas.length > 0) {
    return quotas.map((quota, index) => ({
      id: `${quota.id}-${index}`,
      label: quota.label,
      usage: formatQuotaValue(quota),
    }))
  }
  return allBalances(usage.source).map((balance, index) => ({
    id: `${balance.currency}-${index}`,
    label: balance.currency,
    usage: `余额 ${formatAmount(balance.currency, balance.total)}`,
  }))
}
