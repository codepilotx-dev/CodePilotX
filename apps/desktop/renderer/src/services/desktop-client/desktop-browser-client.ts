import type {
  DesktopBrowserIpcBridge,
  DesktopBrowserSnapshot,
} from '@codepilotx/shared/desktop-browser-ipc'
import type {
  DesktopApi,
  DesktopBrowserBounds,
  DesktopBrowserState,
} from '../../../shared/types.js'
import { defaultDesktopClientEnvironment } from './environment.js'

export const WORKBENCH_BROWSER_TAB_ID = 'workbench-browser'

type BrowserApi = Pick<
  DesktopApi,
  | 'getBrowserState'
  | 'openBrowser'
  | 'navigateBrowser'
  | 'reloadBrowser'
  | 'goBackBrowser'
  | 'goForwardBrowser'
  | 'closeBrowser'
  | 'setBrowserBounds'
  | 'clearBrowserAllowedSites'
>

export type DesktopBrowserClient = BrowserApi & {
  available: boolean
  stopBrowser(): Promise<DesktopBrowserState>
  setBrowserVisible(visible: boolean): Promise<DesktopBrowserState>
  focusBrowser(): Promise<void>
  onBrowserStateChange(listener: (state: DesktopBrowserState) => void): () => void
}

export function createDesktopBrowserClient(
  bridge?: Partial<DesktopBrowserIpcBridge>,
): DesktopBrowserClient {
  const tabInput = { tabId: WORKBENCH_BROWSER_TAB_ID } as const
  const unavailable = (): never => {
    throw new Error('内置浏览器仅在 CodePilotX 桌面应用中可用。')
  }
  const mapState = (state: DesktopBrowserSnapshot): DesktopBrowserState => ({
    open: state.open,
    url: state.url,
    title: state.title,
    loading: state.loading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    error: state.error,
    allowedSites: [...state.allowedSites],
    sitePermissions: state.sitePermissions.map(permission => ({ ...permission })),
  })

  const available = Boolean(
    bridge?.getDesktopBrowserState
      && bridge.createOrRestoreDesktopBrowser
      && bridge.navigateDesktopBrowser
      && bridge.reloadDesktopBrowser
      && bridge.stopDesktopBrowser
      && bridge.goBackDesktopBrowser
      && bridge.goForwardDesktopBrowser
      && bridge.setDesktopBrowserBounds
      && bridge.setDesktopBrowserVisible
      && bridge.focusDesktopBrowser
      && bridge.closeDesktopBrowser
      && bridge.clearDesktopBrowserAllowedSites
      && bridge.onDesktopBrowserStateChange,
  )

  return {
    available,
    getBrowserState: async () => mapState(
      await (bridge?.getDesktopBrowserState?.(tabInput) ?? unavailable()),
    ),
    openBrowser: async url => mapState(
      await (bridge?.createOrRestoreDesktopBrowser?.({
        ...tabInput,
        ...(url === undefined ? {} : { url }),
      }) ?? unavailable()),
    ),
    navigateBrowser: async url => mapState(
      await (bridge?.navigateDesktopBrowser?.({ ...tabInput, url }) ?? unavailable()),
    ),
    reloadBrowser: async () => mapState(
      await (bridge?.reloadDesktopBrowser?.(tabInput) ?? unavailable()),
    ),
    stopBrowser: async () => mapState(
      await (bridge?.stopDesktopBrowser?.(tabInput) ?? unavailable()),
    ),
    goBackBrowser: async () => mapState(
      await (bridge?.goBackDesktopBrowser?.(tabInput) ?? unavailable()),
    ),
    goForwardBrowser: async () => mapState(
      await (bridge?.goForwardDesktopBrowser?.(tabInput) ?? unavailable()),
    ),
    closeBrowser: async () => mapState(
      await (bridge?.closeDesktopBrowser?.(tabInput) ?? unavailable()),
    ),
    setBrowserBounds: async (bounds: DesktopBrowserBounds) => mapState(
      await (bridge?.setDesktopBrowserBounds?.({ ...tabInput, bounds }) ?? unavailable()),
    ),
    setBrowserVisible: async visible => mapState(
      await (bridge?.setDesktopBrowserVisible?.({ ...tabInput, visible }) ?? unavailable()),
    ),
    focusBrowser: async () => {
      await (bridge?.focusDesktopBrowser?.(tabInput) ?? unavailable())
    },
    clearBrowserAllowedSites: async () => mapState(
      await (bridge?.clearDesktopBrowserAllowedSites?.(tabInput) ?? unavailable()),
    ),
    onBrowserStateChange: listener =>
      bridge?.onDesktopBrowserStateChange?.(state => {
        if (state.tabId === WORKBENCH_BROWSER_TAB_ID) listener(mapState(state))
      }) ?? (() => {}),
  }
}

const environment = defaultDesktopClientEnvironment()

export const desktopBrowserClient = createDesktopBrowserClient(
  environment.window?.codePilotXDesktop,
)
