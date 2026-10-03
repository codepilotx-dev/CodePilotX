export const DESKTOP_BROWSER_IPC_CHANNELS = {
  list: 'desktop-browser:list',
  attach: 'desktop-browser:attach',
  control: 'desktop-browser:control',
  layout: 'desktop-browser:layout',
  permission: 'desktop-browser:permission',
  getState: 'desktop-browser:get-state',
  createOrRestore: 'desktop-browser:create-or-restore',
  navigate: 'desktop-browser:navigate',
  reload: 'desktop-browser:reload',
  stop: 'desktop-browser:stop',
  goBack: 'desktop-browser:go-back',
  goForward: 'desktop-browser:go-forward',
  setBounds: 'desktop-browser:set-bounds',
  setVisible: 'desktop-browser:set-visible',
  focus: 'desktop-browser:focus',
  close: 'desktop-browser:close',
  clearAllowedSites: 'desktop-browser:clear-allowed-sites',
  stateChanged: 'desktop-browser:state-changed',
} as const

export interface DesktopBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopBrowserSitePermission {
  origin: string
  decision: 'allow' | 'deny'
  updatedAt: string
}

export interface DesktopBrowserSnapshot {
  tabId: string
  windowId?: string
  sourceThreadId?: string | null
  controlThreadId?: string | null
  generation?: string
  documentId?: string
  state?: 'parked' | 'live' | 'suspended' | 'crashed'
  busy?: boolean
  viewport?: { width: number; height: number }
  panel?: 'right' | 'bottom'
  order?: number
  history?: ReadonlyArray<{ url: string; title: string }>
  historyIndex?: number
  revision?: number
  open: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  allowedSites: string[]
  sitePermissions: DesktopBrowserSitePermission[]
}

export interface DesktopBrowserTabInput {
  tabId: string
}

export interface CreateOrRestoreDesktopBrowserInput extends DesktopBrowserTabInput {
  url?: string
  sourceThreadId?: string | null
}

export interface NavigateDesktopBrowserInput extends DesktopBrowserTabInput {
  url: string
}

export interface SetDesktopBrowserBoundsInput extends DesktopBrowserTabInput {
  bounds: DesktopBrowserBounds
}

export interface SetDesktopBrowserVisibleInput extends DesktopBrowserTabInput {
  visible: boolean
}

export interface DesktopBrowserIpcBridge {
  listDesktopBrowserTabs(): Promise<DesktopBrowserSnapshot[]>
  attachDesktopBrowserGuest(input: {
    tabId: string
    generation: string
    guestId: number
  }): Promise<void>
  controlDesktopBrowser(input: {
    tabId: string
    threadId: string | null
  }): Promise<DesktopBrowserSnapshot>
  layoutDesktopBrowser(input: {
    tabId: string
    panel: 'right' | 'bottom'
    order: number
  }): Promise<void>
  setDesktopBrowserPermission(input: {
    origin: string
    decision: 'allow' | 'deny' | 'remove'
  }): Promise<DesktopBrowserSitePermission[]>
  getDesktopBrowserState(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  createOrRestoreDesktopBrowser(
    input: CreateOrRestoreDesktopBrowserInput,
  ): Promise<DesktopBrowserSnapshot>
  navigateDesktopBrowser(input: NavigateDesktopBrowserInput): Promise<DesktopBrowserSnapshot>
  reloadDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  stopDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  goBackDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  goForwardDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  setDesktopBrowserBounds(input: SetDesktopBrowserBoundsInput): Promise<DesktopBrowserSnapshot>
  setDesktopBrowserVisible(input: SetDesktopBrowserVisibleInput): Promise<DesktopBrowserSnapshot>
  focusDesktopBrowser(input: DesktopBrowserTabInput): Promise<void>
  closeDesktopBrowser(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  clearDesktopBrowserAllowedSites(input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot>
  onDesktopBrowserStateChange(listener: (state: DesktopBrowserSnapshot) => void): () => void
}
