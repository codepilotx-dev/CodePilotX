import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { DrawerTab } from '../../uiTypes.js'
import type { DesktopPermissionMode, DesktopThinkingMode, DesktopWorkspace } from '../../../shared/types.js'
import {
  type StoredDesktopSettings,
  readStoredDesktopSettings,
  storeDesktopSettings,
} from './settingsStorage.js'

export type UseDesktopSettingsResult = {
  permissionMode: DesktopPermissionMode
  model: string
  fallbackModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  drawerTab: DrawerTab
  selectedModelPreset: string
  setPermissionMode: (value: DesktopPermissionMode) => void
  setModel: (value: string) => void
  setFallbackModel: (value: string) => void
  setSessionName: (value: string) => void
  setThinkingMode: (value: DesktopThinkingMode) => void
  setSystemPrompt: (value: string) => void
  setAppendSystemPrompt: (value: string) => void
  setAdditionalDirectories: (value: string) => void
  setRecentWorkspaces: (
    value: DesktopWorkspace[] | ((current: DesktopWorkspace[]) => DesktopWorkspace[]),
  ) => void
  setDrawerTab: (value: DrawerTab) => void
  setSelectedModelPreset: (value: string) => void
}

const DesktopSettingsContext = createContext<UseDesktopSettingsResult | null>(
  null,
)

export function DesktopSettingsProvider({
  children,
}: {
  children: ReactNode
}): ReactNode {
  const settings = useDesktopSettingsState()
  return createElement(
    DesktopSettingsContext.Provider,
    { value: settings },
    children,
  )
}

export function useDesktopSettings(): UseDesktopSettingsResult {
  const settings = useContext(DesktopSettingsContext)
  if (settings) {
    return settings
  }
  return useDesktopSettingsState()
}

function useDesktopSettingsState(): UseDesktopSettingsResult {
  const initial = readStoredDesktopSettings()
  const [permissionMode, setPermissionMode] = useState<DesktopPermissionMode>(
    initial.permissionMode,
  )
  const [model, setModel] = useState(initial.model)
  const [fallbackModel, setFallbackModel] = useState(initial.fallbackModel)
  const [sessionName, setSessionName] = useState(initial.sessionName)
  const [thinkingMode, setThinkingMode] = useState<DesktopThinkingMode>(
    initial.thinkingMode,
  )
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt)
  const [appendSystemPrompt, setAppendSystemPrompt] = useState(
    initial.appendSystemPrompt,
  )
  const [additionalDirectories, setAdditionalDirectories] = useState(
    initial.additionalDirectories,
  )
  const [recentWorkspaces, setRecentWorkspaces] = useState<DesktopWorkspace[]>(
    initial.recentWorkspaces,
  )
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(initial.drawerTab)
  const [selectedModelPreset, setSelectedModelPreset] = useState<string>(
    initial.selectedModelPreset,
  )

  useEffect(() => {
    const next: StoredDesktopSettings = {
      permissionMode,
      model,
      fallbackModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      recentWorkspaces,
      drawerTab,
      selectedModelPreset,
    }
    storeDesktopSettings(next)
  }, [
    permissionMode,
    model,
    fallbackModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    recentWorkspaces,
    drawerTab,
    selectedModelPreset,
  ])

  return {
    permissionMode,
    model,
    fallbackModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    recentWorkspaces,
    drawerTab,
    selectedModelPreset,
    setPermissionMode,
    setModel,
    setFallbackModel,
    setSessionName,
    setThinkingMode,
    setSystemPrompt,
    setAppendSystemPrompt,
    setAdditionalDirectories,
    setRecentWorkspaces,
    setDrawerTab,
    setSelectedModelPreset,
  }
}
