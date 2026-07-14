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
    <div className="sidebar-layout settings-sidebar-layout">
      <SettingsNav
        activeTab={activeTab}
        onBack={onBack}
        onTabChange={onTabChange}
      />
    </div>
  );
}
