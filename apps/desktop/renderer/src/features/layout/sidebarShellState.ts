import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

export const SIDEBAR_DRAWER_BREAKPOINT = 720

export type SidebarShellMode =
  | 'docked'
  | 'collapsed'
  | 'preview'
  | 'drawer'

export type SidebarEscapeAction =
  | 'none'
  | 'close-transient'
  | 'settings-back'

export function resolveSidebarEscapeAction({
  defaultPrevented,
  isDialogOpen,
  isSettingsRoute,
  isTextEntry,
  mode,
}: {
  defaultPrevented: boolean
  isDialogOpen: boolean
  isSettingsRoute: boolean
  isTextEntry: boolean
  mode: SidebarShellMode
}): SidebarEscapeAction {
  if (defaultPrevented) return 'none'
  if (mode === 'preview' || mode === 'drawer') return 'close-transient'
  if (!isSettingsRoute || isDialogOpen || isTextEntry) return 'none'
  return 'settings-back'
}

export function deriveSidebarShellMode({
  containerWidth,
  desktopCollapsed,
  drawerOpen,
  previewOpen,
}: {
  containerWidth: number
  desktopCollapsed: boolean
  drawerOpen: boolean
  previewOpen: boolean
}): SidebarShellMode {
  if (containerWidth <= SIDEBAR_DRAWER_BREAKPOINT) {
    return drawerOpen ? 'drawer' : 'collapsed'
  }
  if (!desktopCollapsed) return 'docked'
  return previewOpen ? 'preview' : 'collapsed'
}

export type SidebarShellController = {
  appBodyRef: RefObject<HTMLDivElement | null>
  canPreview: boolean
  mode: SidebarShellMode
  closeTransient: () => void
  onSidebarBlur: (event: React.FocusEvent<HTMLElement>) => void
  onSidebarFocus: () => void
  onSidebarPointerEnter: () => void
  onSidebarPointerLeave: (hasFocusWithin: boolean) => void
  onTriggerBlur: () => void
  onTriggerFocus: () => void
  onTriggerPointerEnter: () => void
  onTriggerPointerLeave: (hasFocusWithin: boolean) => void
  toggle: () => void
}

export function useSidebarShellController({
  desktopCollapsed,
  setDesktopCollapsed,
}: {
  desktopCollapsed: boolean
  setDesktopCollapsed: (collapsed: boolean) => void
}): SidebarShellController {
  const appBodyRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(() => window.innerWidth)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const pointerInsideRef = useRef(false)
  const mode = deriveSidebarShellMode({
    containerWidth,
    desktopCollapsed,
    drawerOpen,
    previewOpen,
  })
  const narrow = containerWidth <= SIDEBAR_DRAWER_BREAKPOINT
  const canPreview = desktopCollapsed && !narrow

  useEffect(() => {
    const root = appBodyRef.current
    if (!root) return
    const update = (): void => setContainerWidth(root.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (narrow) {
      setPreviewOpen(false)
      pointerInsideRef.current = false
    } else {
      setDrawerOpen(false)
    }
  }, [narrow])

  useEffect(() => {
    if (desktopCollapsed && !narrow) return
    setPreviewOpen(false)
  }, [desktopCollapsed, narrow])

  const closeTransient = useCallback((): void => {
    setDrawerOpen(false)
    setPreviewOpen(false)
    pointerInsideRef.current = false
  }, [])

  const openPreview = useCallback((): void => {
    if (!narrow && desktopCollapsed) setPreviewOpen(true)
  }, [desktopCollapsed, narrow])

  const closePreview = useCallback((): void => {
    if (!narrow) setPreviewOpen(false)
  }, [narrow])

  return {
    appBodyRef,
    canPreview,
    mode,
    closeTransient,
    onSidebarBlur: event => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      if (!pointerInsideRef.current) closePreview()
    },
    onSidebarFocus: () => {
      openPreview()
    },
    onSidebarPointerEnter: () => {
      pointerInsideRef.current = true
      openPreview()
    },
    onSidebarPointerLeave: hasFocusWithin => {
      pointerInsideRef.current = false
      if (!hasFocusWithin) closePreview()
    },
    onTriggerBlur: () => {
      if (!pointerInsideRef.current) closePreview()
    },
    onTriggerFocus: () => {
      openPreview()
    },
    onTriggerPointerEnter: () => {
      pointerInsideRef.current = true
      openPreview()
    },
    onTriggerPointerLeave: hasFocusWithin => {
      pointerInsideRef.current = false
      if (!hasFocusWithin) closePreview()
    },
    toggle: () => {
      if (narrow) {
        setDrawerOpen(current => !current)
        setPreviewOpen(false)
        return
      }
      setDesktopCollapsed(!desktopCollapsed)
      closeTransient()
    },
  }
}
