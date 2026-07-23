import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import type { PetDescriptor } from '@codepilotx/agent-protocol'
import { Settings } from 'lucide-react'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { PetCatalogSection } from './PetCatalogSection.js'
import { usePetSettingsController } from './usePetSettingsController.js'
import '../../styles/lazy/pet-catalog.scss'

export function PetCatalogPage(): React.ReactNode {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const {
    pets,
    refreshPets,
    selectPet,
    setEnabled,
    settings,
  } = usePetSettingsController({ onError: setErrorMessage })

  const installAndSelect = async (installed: PetDescriptor): Promise<void> => {
    await refreshPets()
    await selectPet(installed.id)
  }

  return (
    <div className="pet-catalog-page">
      <GlobalErrorModal
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
      <GlobalErrorModal
        message={noticeMessage}
        onDismiss={() => setNoticeMessage(null)}
        tone="status"
      />

      <div className="pet-catalog-scroll-region">
        <main className="pet-catalog-content">
          <header className="pet-catalog-page-heading">
            <div>
              <h1>宠物商店</h1>
              <p>
                浏览并一键安装 awesome-codex-pet 社区中的桌面伙伴。
              </p>
            </div>
            <Button
              onClick={() => navigate('/settings/pets')}
              type="button"
            >
              <Settings size={APP_ICON_SIZE} />
              宠物设置
            </Button>
          </header>

          <PetCatalogSection
            installedPets={pets}
            onEnableOverlay={() => setEnabled(true)}
            onError={setErrorMessage}
            onInstalled={installAndSelect}
            onNotice={setNoticeMessage}
            onSelect={id => void selectPet(id)}
            overlayEnabled={settings.enabled}
            selectedPetId={settings.selectedPetId}
          />
        </main>
      </div>
    </div>
  )
}
