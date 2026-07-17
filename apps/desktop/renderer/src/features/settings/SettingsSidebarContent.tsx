import type React from "react";
import { SettingsNav } from "./SettingsNav.js";

type Props = {
  activeTab: string;
  onBack: () => void;
  onTabChange: (tabId: string) => void;
};

export function SettingsSidebarContent({
  activeTab,
  onBack,
  onTabChange,
}: Props): React.ReactNode {
  return (
    <div className="sidebar-layout settings-sidebar-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-chrome tw:py-2">
      <SettingsNav
        activeTab={activeTab}
        onBack={onBack}
        onTabChange={onTabChange}
      />
    </div>
  );
}
