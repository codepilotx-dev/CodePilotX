import React, { useEffect, useMemo, useState } from 'react'
import type {
  PetCatalogItem,
  PetCatalogResult,
  PetDescriptor,
} from '@codepilotx/agent-protocol'
import {
  Download,
  PawPrint,
  RefreshCw,
  SearchX,
  Sparkles,
} from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { SettingsSection } from './SettingsSection.js'
import {
  filterPetCatalog,
  listPetCatalogCategories,
  petLicenseLabel,
  petLicenseNeedsConfirmation,
  type PetCatalogVersionFilter,
} from './petCatalogModel.js'

type Props = {
  installedPets: readonly PetDescriptor[]
  selectedPetId: string | null
  overlayEnabled: boolean
  onEnableOverlay: () => Promise<void>
  onInstalled: (pet: PetDescriptor) => Promise<void>
  onSelect: (id: string) => void
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

const EMPTY_CATALOG: PetCatalogResult = {
  pets: [],
  fetchedAt: null,
  cacheState: 'unavailable',
}

export function PetCatalogSection({
  installedPets,
  selectedPetId,
  overlayEnabled,
  onEnableOverlay,
  onInstalled,
  onSelect,
  onError,
  onNotice,
}: Props): React.ReactNode {
  const [catalog, setCatalog] = useState<PetCatalogResult>(EMPTY_CATALOG)
  const [loading, setLoading] = useState(true)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [version, setVersion] =
    useState<PetCatalogVersionFilter>('all')
  const [licensePet, setLicensePet] = useState<PetCatalogItem | null>(null)
  const [previewFailures, setPreviewFailures] = useState<Set<string>>(
    () => new Set(),
  )
  const [showWakeAction, setShowWakeAction] = useState(false)

  const installedIds = useMemo(
    () => new Set(installedPets.map(pet => pet.id)),
    [installedPets],
  )
  const categories = useMemo(
    () => listPetCatalogCategories(catalog.pets),
    [catalog.pets],
  )
  const visiblePets = useMemo(
    () => filterPetCatalog(catalog.pets, { query, category, version }),
    [catalog.pets, category, query, version],
  )

  const loadCatalog = async (refresh = false): Promise<void> => {
    setLoading(true)
    try {
      setCatalog(await desktopClient.listPetCatalog(refresh))
    } catch (error) {
      onError(messageOf(error))
      if (!catalog.pets.length) setCatalog(EMPTY_CATALOG)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCatalog()
    // The catalog loads once when the settings section mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installAndUse = async (
    pet: PetCatalogItem,
    acceptedRestrictedLicense = false,
  ): Promise<void> => {
    setLicensePet(null)
    setInstallingSlug(pet.slug)
    try {
      const installed = await desktopClient.installCatalogPet(
        pet.slug,
        acceptedRestrictedLicense,
      )
      await onInstalled(installed)
      setCatalog(current => ({
        ...current,
        pets: current.pets.map(item =>
          item.slug === pet.slug ? { ...item, installed: true } : item
        ),
      }))
      setShowWakeAction(!overlayEnabled)
      onNotice?.(`已安装并使用 ${installed.displayName}`)
    } catch (error) {
      onError(messageOf(error))
    } finally {
      setInstallingSlug(null)
    }
  }

  const choosePet = (pet: PetCatalogItem): void => {
    if (installedIds.has(pet.slug) || pet.installed) {
      onSelect(pet.slug)
      return
    }
    if (petLicenseNeedsConfirmation(pet.licenseKind)) {
      setLicensePet(pet)
      return
    }
    void installAndUse(pet)
  }

  return (
    <>
      <SettingsSection
        bare
        title="社区宠物"
        description="浏览并一键安装 awesome-codex-pet 社区中的桌面伙伴。"
        actions={
          <Button
            aria-label="刷新社区宠物"
            disabled={loading}
            onClick={() => void loadCatalog(true)}
            type="button"
          >
            <RefreshCw size={APP_ICON_SIZE} />
            刷新
          </Button>
        }
      >
        <div className="pet-catalog-panel settings-card">
          <div className="pet-catalog-filters">
            <SearchInput
              aria-label="搜索社区宠物"
              onChange={setQuery}
              placeholder="搜索名称、作者或描述"
              value={query}
            />
            <select
              aria-label="宠物分类"
              className="pet-settings-select"
              onChange={event => setCategory(event.target.value)}
              value={category}
            >
              <option value="">全部分类</option>
              {categories.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              aria-label="宠物图集版本"
              className="pet-settings-select"
              onChange={event => {
                const value = event.target.value
                setVersion(value === 'all' ? 'all' : Number(value) as 1 | 2)
              }}
              value={version}
            >
              <option value="all">全部版本</option>
              <option value="1">v1 动画</option>
              <option value="2">v2 · 16 方位</option>
            </select>
          </div>

          {catalog.cacheState === 'stale' ? (
            <p className="pet-catalog-status" role="status">
              当前显示上次成功获取的目录，联网后可手动刷新。
            </p>
          ) : null}
          {showWakeAction && !overlayEnabled ? (
            <div className="pet-catalog-wake" role="status">
              <span>新宠物已经准备好了。</span>
              <Button
                onClick={() => {
                  void onEnableOverlay().then(() => setShowWakeAction(false))
                }}
                type="button"
                variant="primary"
              >
                <Sparkles size={APP_ICON_SIZE} />
                立即唤醒
              </Button>
            </div>
          ) : null}

          {loading && !catalog.pets.length ? (
            <div className="pet-catalog-empty" role="status">
              <span className="ui-button-spinner" />
              正在载入社区宠物…
            </div>
          ) : null}
          {!loading && catalog.cacheState === 'unavailable' ? (
            <div className="pet-catalog-empty">
              <PawPrint size={28} />
              <strong>暂时无法获取社区目录</strong>
              <span>请检查网络连接；已安装的宠物仍可正常使用。</span>
              <Button onClick={() => void loadCatalog(true)} type="button">
                重试
              </Button>
            </div>
          ) : null}
          {!loading
            && catalog.cacheState !== 'unavailable'
            && !visiblePets.length ? (
              <div className="pet-catalog-empty">
                <SearchX size={28} />
                <strong>没有匹配的宠物</strong>
                <span>尝试更换关键词或筛选条件。</span>
              </div>
            ) : null}

          {visiblePets.length ? (
            <div className="pet-catalog-grid">
              {visiblePets.map(pet => {
                const installed = installedIds.has(pet.slug) || pet.installed
                const selected = selectedPetId === pet.slug
                const installing = installingSlug === pet.slug
                return (
                  <article className="pet-catalog-card" key={pet.slug}>
                    <div className="pet-catalog-art">
                      {!previewFailures.has(pet.slug) ? (
                        <img
                          alt=""
                          decoding="async"
                          loading="lazy"
                          onError={() => {
                            setPreviewFailures(current => {
                              const next = new Set(current)
                              next.add(pet.slug)
                              return next
                            })
                          }}
                          src={pet.previewUrl}
                        />
                      ) : (
                        <PawPrint aria-hidden="true" size={34} />
                      )}
                    </div>
                    <div className="pet-catalog-card-body">
                      <div className="pet-catalog-card-heading">
                        <strong>{pet.displayName}</strong>
                        <span>v{pet.spriteVersionNumber}</span>
                      </div>
                      <p className="pet-catalog-author">作者：{pet.author}</p>
                      <p className="pet-catalog-description">
                        {pet.description || '这个宠物还没有介绍。'}
                      </p>
                      <div className="pet-catalog-tags">
                        <span>{pet.categoryLabel}</span>
                        <span data-license={pet.licenseKind}>
                          {petLicenseLabel(pet.licenseKind)}
                        </span>
                      </div>
                      <Button
                        disabled={selected || installing}
                        loading={installing}
                        onClick={() => choosePet(pet)}
                        type="button"
                        variant={selected ? 'secondary' : 'primary'}
                      >
                        {!installing && !installed ? (
                          <Download size={APP_ICON_SIZE} />
                        ) : null}
                        {installing
                          ? '安装中'
                          : selected
                            ? '使用中'
                            : installed
                              ? '使用'
                              : '安装并使用'}
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <ConfirmationDialog
        actionDisabled={installingSlug !== null}
        actionLabel="我已了解，继续安装"
        description={
          licensePet ? (
            <span className="pet-license-confirmation">
              <span>
                “{licensePet.displayName}”由 {licensePet.author} 提供。
              </span>
              <span className="pet-license-confirmation-text">
                {licensePet.license}
              </span>
              <span>请仅在上述许可允许的范围内使用和分发。</span>
            </span>
          ) : undefined
        }
        onAction={() => {
          if (licensePet) void installAndUse(licensePet, true)
        }}
        onCancel={() => setLicensePet(null)}
        open={licensePet !== null}
        title={
          licensePet?.licenseKind === 'unknown'
            ? '确认未知许可证'
            : '确认使用限制'
        }
      />
    </>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
