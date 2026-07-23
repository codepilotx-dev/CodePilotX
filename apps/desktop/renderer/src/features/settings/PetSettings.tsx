import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PetDescriptor,
  PetInstallPreview,
} from '@codepilotx/agent-protocol'
import { PawPrint, RefreshCw, Trash2 } from 'lucide-react'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import {
  getPetPresentationBridge,
  presentationFromPetSettings,
  type PetPresentation,
} from '../pet/petPresentation.js'

const PET_SIZE_SAVE_DEBOUNCE_MS = 100

type Props = {
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

export function PetSettings({
  onError,
  onNotice,
}: Props): React.ReactNode {
  const { draft } = useDesktopSettings()
  const [pets, setPets] = useState<readonly PetDescriptor[]>([])
  const [sourceUrl, setSourceUrl] = useState('')
  const [preview, setPreview] = useState<PetInstallPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const settings = draft.values.pet
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const committedPresentationRef = useRef(
    presentationFromPetSettings(settings),
  )
  const desiredPresentationRef = useRef(
    presentationFromPetSettings(settings),
  )
  const draftRef = useRef(draft)
  draftRef.current = draft
  const sizeSaveTimerRef = useRef<number | null>(null)
  const saveSequenceRef = useRef(Promise.resolve())

  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await desktopClient.listPets()
      setPets(next)
      if (
        settings.selectedPetId
        && !next.some(pet => pet.id === settings.selectedPetId)
      ) {
        selectPet(next[0]?.id ?? null)
      }
    } catch (error) {
      onError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // Catalog refresh is intentionally a one-time page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updatePet = (
    patch: Partial<typeof settings>,
    autoSave = true,
  ): void => {
    settingsRef.current = { ...settingsRef.current, ...patch }
    draft.setValue('pet', current => ({ ...current, ...patch }))
    if (autoSave) draft.autoSave()
  }

  const previewPresentation = useCallback(
    (presentation: PetPresentation): void => {
      const previewer = getPetPresentationBridge()?.previewPetPresentation
      if (typeof previewer !== 'function') return
      void Promise.resolve(previewer(presentation)).catch(error => {
        onError(messageOf(error))
      })
    },
    [onError],
  )

  const commitPresentation = useCallback(
    (presentation: PetPresentation): Promise<void> => {
      saveSequenceRef.current = saveSequenceRef.current.then(async () => {
        try {
          const saved = await draftRef.current.save()
          const canonical = presentationFromPetSettings(saved.pet)
          committedPresentationRef.current = canonical
          previewPresentation(canonical)
        } catch (error) {
          if (!samePresentation(desiredPresentationRef.current, presentation)) {
            return
          }
          const rollback = committedPresentationRef.current
          draftRef.current.setValue('pet', current => ({
            ...current,
            selectedPetId: rollback.selectedPetId,
            size: rollback.size,
          }))
          previewPresentation(rollback)
          onError(messageOf(error))
        }
      })
      return saveSequenceRef.current
    },
    [onError, previewPresentation],
  )

  const flushPendingSize = useCallback((): void => {
    if (sizeSaveTimerRef.current === null) return
    window.clearTimeout(sizeSaveTimerRef.current)
    sizeSaveTimerRef.current = null
    void commitPresentation(presentationFromPetSettings(settingsRef.current))
  }, [commitPresentation])

  useEffect(() => {
    return desktopClient.onDesktopSettingsChange(change => {
      const canonical = presentationFromPetSettings(change.settings.pet)
      committedPresentationRef.current = canonical
      if (sizeSaveTimerRef.current === null) {
        desiredPresentationRef.current = canonical
        previewPresentation(canonical)
      }
    })
  }, [previewPresentation])

  useEffect(() => {
    return () => {
      if (sizeSaveTimerRef.current !== null) {
        window.clearTimeout(sizeSaveTimerRef.current)
        sizeSaveTimerRef.current = null
        void commitPresentation(
          presentationFromPetSettings(settingsRef.current),
        )
      }
    }
  }, [commitPresentation])

  const selectPet = (selectedPetId: string | null): void => {
    if (sizeSaveTimerRef.current !== null) {
      window.clearTimeout(sizeSaveTimerRef.current)
      sizeSaveTimerRef.current = null
    }
    const presentation = {
      ...presentationFromPetSettings(settingsRef.current),
      selectedPetId,
    }
    updatePet({ selectedPetId }, false)
    desiredPresentationRef.current = presentation
    previewPresentation(presentation)
    void commitPresentation(presentation)
  }

  const previewSize = (size: number): void => {
    const presentation = {
      ...presentationFromPetSettings(settingsRef.current),
      size,
    }
    updatePet({ size }, false)
    desiredPresentationRef.current = presentation
    previewPresentation(presentation)
    if (sizeSaveTimerRef.current !== null) {
      window.clearTimeout(sizeSaveTimerRef.current)
    }
    sizeSaveTimerRef.current = window.setTimeout(() => {
      sizeSaveTimerRef.current = null
      void commitPresentation(presentation)
    }, PET_SIZE_SAVE_DEBOUNCE_MS)
  }

  const setEnabled = async (enabled: boolean): Promise<void> => {
    try {
      if (enabled) await window.codePilotXDesktop?.openPetOverlay()
      else await window.codePilotXDesktop?.hidePetOverlay()
      updatePet({ enabled })
    } catch (error) {
      onError(messageOf(error))
    }
  }

  const loadPreview = async (): Promise<void> => {
    const url = sourceUrl.trim()
    if (!url) return
    setBusy(true)
    try {
      setPreview(await desktopClient.previewPetInstall(url))
    } catch (error) {
      setPreview(null)
      onError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    const url = sourceUrl.trim()
    if (!url || !preview) return
    setBusy(true)
    try {
      const installed = await desktopClient.installPet(url)
      const next = await desktopClient.listPets()
      setPets(next)
      setPreview(null)
      setSourceUrl('')
      selectPet(installed.id)
      onNotice?.(`已安装 ${installed.displayName}`)
    } catch (error) {
      onError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const id = settings.selectedPetId
    if (!id) return
    const pet = pets.find(item => item.id === id)
    if (!window.confirm(`删除宠物 ${pet?.displayName ?? id}？`)) return
    setBusy(true)
    try {
      await desktopClient.removePet(id)
      const next = await desktopClient.listPets()
      setPets(next)
      selectPet(next[0]?.id ?? null)
      onNotice?.('宠物已删除')
    } catch (error) {
      onError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsContentArea className="pet-settings-page">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">宠物</h2>
          <p className="settings-page-desc">
            桌面伙伴会跟随任务状态，并把需要你处理的事项带到最前面。
          </p>
        </div>

        <SettingsSection title="桌面伙伴">
          <SettingsRow
            title="唤醒宠物"
            description="在所有工作区上方显示透明宠物浮窗"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="唤醒宠物"
                checked={settings.enabled}
                onChange={value => void setEnabled(value)}
              />
            }
          />
          <SettingsRow
            title="选择宠物"
            description={pets.length ? '使用已安装的宠物包' : '尚未安装宠物'}
            autoSave
            control={
              <div className="pet-settings-inline">
                <select
                  aria-label="选择宠物"
                  className="pet-settings-select"
                  disabled={!pets.length}
                  value={settings.selectedPetId ?? ''}
                  onChange={event =>
                    selectPet(event.target.value || null)
                  }
                >
                  {!pets.length ? <option value="">无可用宠物</option> : null}
                  {pets.map(pet => (
                    <option key={pet.id} value={pet.id}>
                      {pet.displayName}
                    </option>
                  ))}
                </select>
                <Button disabled={busy} onClick={() => void refresh()} type="button">
                  <RefreshCw size={APP_ICON_SIZE} />
                </Button>
                <Button
                  disabled={busy || !settings.selectedPetId}
                  onClick={() => void remove()}
                  type="button"
                >
                  <Trash2 size={APP_ICON_SIZE} />
                </Button>
              </div>
            }
          />
          <SettingsRow
            title="宠物大小"
            description={`${settings.size} px（图集单元比例 192:208）`}
            autoSave
            control={
              <input
                aria-label="宠物大小"
                max={224}
                min={80}
                type="range"
                value={settings.size}
                onBlur={flushPendingSize}
                onChange={event => previewSize(Number(event.target.value))}
                onPointerUp={flushPendingSize}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title="任务提醒">
          <SettingsRow
            title="需要处理"
            description="审批、问题和计划等待时保持提醒"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="需要处理提醒"
                checked={settings.notifyAttention}
                onChange={value => updatePet({ notifyAttention: value })}
              />
            }
          />
          <SettingsRow
            title="任务完成"
            description="任务完成后显示短时提醒"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="任务完成提醒"
                checked={settings.notifyCompletion}
                onChange={value => updatePet({ notifyCompletion: value })}
              />
            }
          />
          <SettingsRow
            title="任务失败"
            description="任务失败或中断时显示高优先级提醒"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="任务失败提醒"
                checked={settings.notifyFailure}
                onChange={value => updatePet({ notifyFailure: value })}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="安装自定义宠物"
          description="输入 pet.json 的 HTTPS 地址；localhost 开发地址可使用 HTTP。"
        >
          <div className="pet-settings-installer">
            <Input
              value={sourceUrl}
              onChange={event => {
                setSourceUrl(event.target.value)
                setPreview(null)
              }}
              placeholder="https://example.com/my-pet/pet.json"
            />
            <Button
              disabled={busy || !sourceUrl.trim()}
              onClick={() => void loadPreview()}
              type="button"
            >
              预览
            </Button>
          </div>
          {preview ? (
            <div className="pet-settings-preview">
              <PawPrint size={20} />
              <div>
                <strong>{preview.pet.displayName}</strong>
                <p>
                  {preview.pet.description || '无描述'} · v
                  {preview.pet.spriteVersionNumber} ·{' '}
                  {(preview.sizeBytes / 1024).toFixed(1)} KiB
                </p>
              </div>
              <Button disabled={busy} onClick={() => void install()} type="button">
                安装
              </Button>
            </div>
          ) : null}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function samePresentation(
  left: PetPresentation,
  right: PetPresentation,
): boolean {
  return left.selectedPetId === right.selectedPetId && left.size === right.size
}
