import { useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home } from 'lucide-react'
import { IconButton } from '../../../components/ui/IconButton.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { newSessionPath } from '../../session/newSessionSurface.js'
import { canShowSidebarTooltip, type SidebarShellController } from '../sidebarShellState.js'
import { SidebarFooter } from './SidebarFooter.js'
import { getSidebarTopNavItems, type SidebarCapabilityState } from './SidebarTopNav.js'
import { sidebarPaneForRoute, type SidebarPane } from './sidebarNavigation.js'

type Props = {
  shell: SidebarShellController
  activePane: SidebarPane | null
  capabilityState: SidebarCapabilityState
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onReport: (message: string) => void
  onPinPanel: () => void
}

export function SidebarNavigationRail({ shell, activePane, capabilityState, onOpenWhatsNew, onReport, onPinPanel }: Props): ReactNode {
  const { sidebarProductMode, sidebarTimelineEnabled } = useDesktopSettings()
  const { t } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const [tooltipId, setTooltipId] = useState<string | null>(null)
  const lastChatPath = useRef(newSessionPath(sidebarProductMode))
  if (location.pathname === '/new' || location.pathname.startsWith('/threads/')) lastChatPath.current = `${location.pathname}${location.search}`
  const items = getSidebarTopNavItems({ showProjects: false, surface: sidebarProductMode, capabilityState })
  const button = (id: string, label: string, icon: ReactNode, onClick: () => void, pane?: SidebarPane | null, selected = false): ReactNode => (
    <Tooltip
      content={t(label)} side="right" key={id}
      open={tooltipId === id && canShowSidebarTooltip(shell.mode, false)}
      onOpenChange={open => setTooltipId(current => open ? id : current === id ? null : current)}
    >
      <IconButton
        title={t(label)}
        nativeTitle={false}
        aria-label={t(label)}
        aria-current={selected ? 'page' : undefined}
        aria-controls={pane ? 'desktop-sidebar-pane' : undefined}
        active={selected}
        className="sidebar-rail-button"
        color="ghost"
        size="icon"
        onClick={onClick}
      >{icon}</IconButton>
    </Tooltip>
  )
  return (
    <nav className="sidebar-navigation-rail" aria-label={t('应用导航')}>
      <div className="sidebar-rail-destinations">
        {button('home', '首页', <Home size={APP_ICON_SIZE} />, () => {
          navigate(lastChatPath.current)
          onPinPanel()
        }, sidebarTimelineEnabled ? 'activity' : 'chats', activePane === 'chats' || activePane === 'activity')}
        {items.filter(item => item.view !== 'new').map(item => {
          const pane = sidebarPaneForRoute(item.path, false)
          const selected = pane ? activePane === pane : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
          return button(item.view, item.label, item.icon, () => {
            navigate(item.path)
            if (pane) onPinPanel()
          }, pane, selected)
        })}
      </div>
      <div className="sidebar-rail-bottom">
        <SidebarFooter compact onNavigate={onPinPanel} onOpenWhatsNew={onOpenWhatsNew} onReport={onReport} />
      </div>
    </nav>
  )
}
