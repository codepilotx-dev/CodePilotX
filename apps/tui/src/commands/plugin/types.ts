export type ViewState = string

export interface PluginSettingsProps {
  onBack?: () => void
  onNavigate?: (view: ViewState) => void
}
