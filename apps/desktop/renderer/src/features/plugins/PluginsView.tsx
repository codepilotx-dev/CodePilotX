import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertOctagon,
  Clock,
  ListFilter,
  RefreshCw,
} from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import {
  SkeletonBlock,
  SkeletonRegion,
} from '../../components/ui/Skeleton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type {
  DesktopSkillCatalogItem,
  DesktopSkillOwnerFilter,
} from '../../../shared/types.js'
import { PluginCatalogRow } from './PluginCatalogRow.js'
import { PluginDetailsDialog } from './PluginDetailsDialog.js'
import { PluginIcon } from './PluginIcon.js'
import { SkillCatalogRow } from './SkillCatalogRow.js'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  filterPluginCatalog,
  groupPluginCatalogBySource,
  mergeBuiltinPluginState,
  pluginPrimaryAction,
  selectIncludedPluginOverview,
  type PluginCatalogItem,
  type PluginCategoryFilter,
  type PluginStatusFilter,
} from './pluginCatalog.js'
import { groupSkillsForDisplay } from './skillCatalog.js'
import { useBuiltinPluginCatalog } from './useBuiltinPluginCatalog.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'

const SKILLS_SH_API_DOCS_URL = 'https://www.skills.sh/docs/api#authentication'

type Tab = 'plugins' | 'skills'

const TAB_OPTIONS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'plugins', label: '插件' },
  { value: 'skills', label: '技能' },
]

const CATEGORY_OPTIONS: ReadonlyArray<{
  id: PluginCategoryFilter
  label: string
}> = [
  { id: 'all', label: '全部' },
  { id: 'included', label: '内置' },
  { id: 'manageable', label: '可管理' },
  { id: 'external', label: '外部' },
]

const STATUS_OPTIONS: ReadonlyArray<{
  id: PluginStatusFilter
  label: string
}> = [
  { id: 'all', label: '全部状态' },
  { id: 'enabled', label: '已启用' },
  { id: 'disabled', label: '已禁用' },
  { id: 'unavailable', label: '当前不可用' },
]

const SKILL_OWNER_OPTIONS: ReadonlyArray<{
  id: DesktopSkillOwnerFilter
  label: string
}> = [
  { id: 'all', label: '全部' },
  { id: 'official', label: '官方' },
  { id: 'community', label: '社区' },
]

export function PluginsView(): React.ReactNode {
  const [tab, setTab] = useState<Tab>('plugins')
  const [pluginQuery, setPluginQuery] = useState('')
  const [skillQuery, setSkillQuery] = useState('')
  const [pluginCategory, setPluginCategory] = useState<PluginCategoryFilter>('all')
  const [pluginStatus, setPluginStatus] = useState<PluginStatusFilter>('all')
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [skillOwner, setSkillOwner] = useState<DesktopSkillOwnerFilter>('official')
  const {
    plugins: builtinPlugins,
    error: pluginLoadError,
    loading: pluginsLoading,
    refresh: refreshBuiltinPlugins,
    setEnabled: setBuiltinPluginEnabled,
  } = useBuiltinPluginCatalog()
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(() => new Set())
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({})
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTrigger, setDetailTrigger] = useState<HTMLElement | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [skills, setSkills] = useState<DesktopSkillCatalogItem[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillsReloadKey, setSkillsReloadKey] = useState(0)
  const [installingSkillIds, setInstallingSkillIds] = useState<Set<string>>(
    () => new Set(),
  )
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null)
  const scrollRegionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (tab !== 'skills') return
    let cancelled = false
    setSkillsLoading(true)
    setSkillsError(null)
    desktopClient
      .listSkillsCatalog({
        query: skillQuery,
        owner: skillOwner,
        view: 'trending',
        page: 0,
        perPage: 24,
      })
      .then(result => {
        if (!cancelled) setSkills(result.skills)
      })
      .catch(error => {
        if (cancelled) return
        setSkillsError(
          error instanceof Error ? error.message : '技能目录加载失败。',
        )
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [skillOwner, skillQuery, skillsReloadKey, tab])

  const pluginItems = useMemo(
    () =>
      mergeBuiltinPluginState(
        PLUGIN_CATALOG_DESCRIPTORS,
        builtinPlugins,
        pluginLoadError,
      ),
    [builtinPlugins, pluginLoadError],
  )

  const visiblePlugins = useMemo(
    () =>
      filterPluginCatalog(
        pluginItems,
        pluginQuery,
        pluginCategory,
        pluginStatus,
      ),
    [pluginCategory, pluginItems, pluginQuery, pluginStatus],
  )

  const includedPluginOverview = useMemo(
    () => selectIncludedPluginOverview(pluginItems),
    [pluginItems],
  )

  const pluginGroups = useMemo(
    () => groupPluginCatalogBySource(visiblePlugins),
    [visiblePlugins],
  )

  const skillGroups = useMemo(() => groupSkillsForDisplay(skills), [skills])

  const selectedPlugin = selectedPluginId
    ? pluginItems.find(item => item.id === selectedPluginId) ?? null
    : null
  const selectedStatusLabel =
    STATUS_OPTIONS.find(option => option.id === pluginStatus)?.label ?? '全部状态'

  useEffect(() => {
    if (!detailOpen || !selectedPluginId) return
    if (visiblePlugins.some(item => item.id === selectedPluginId)) return
    if (detailTrigger?.isConnected) return
    setDetailOpen(false)
    window.requestAnimationFrame(() => statusTriggerRef.current?.focus())
  }, [detailOpen, detailTrigger, selectedPluginId, visiblePlugins])

  function selectTab(nextTab: Tab): void {
    setTab(nextTab)
    if (nextTab !== 'plugins') setDetailOpen(false)
    scrollRegionRef.current?.scrollTo({ top: 0 })
  }

  async function runPluginAction(
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
  ): Promise<void> {
    if (busyPluginIds.has(item.id)) return
    const action = pluginPrimaryAction(item)
    if (!action || action.disabled) return

    setPluginErrors(current => ({ ...current, [item.id]: '' }))
    if (action.kind === 'open-external') {
      if (!item.externalURL) return
      try {
        await desktopClient.openExternalURL(item.externalURL)
      } catch (error) {
        setPluginErrors(current => ({
          ...current,
          [item.id]: error instanceof Error ? error.message : '无法打开安装说明。',
        }))
      }
      return
    }

    if (!item.builtinPluginId || (item.status !== 'enabled' && item.status !== 'disabled')) {
      return
    }

    setBusyPluginIds(current => new Set(current).add(item.id))
    const previousEnabled = item.status === 'enabled'
    try {
      const result = await setBuiltinPluginEnabled(
        item.builtinPluginId,
        !previousEnabled,
      )
      setAnnouncement(`${item.name}已${result.enabled ? '启用' : '禁用'}。`)
      const remainsVisible =
        pluginStatus === 'all' ||
        (pluginStatus === 'enabled' && result.enabled) ||
        (pluginStatus === 'disabled' && !result.enabled)
      window.requestAnimationFrame(() => {
        if (remainsVisible) trigger.focus()
        else {
          setDetailOpen(false)
          window.requestAnimationFrame(() => statusTriggerRef.current?.focus())
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : `${item.name}状态更新失败。`
      setPluginErrors(current => ({ ...current, [item.id]: message }))
      setAnnouncement(message)
      window.requestAnimationFrame(() => trigger.focus())
    } finally {
      setBusyPluginIds(current => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  async function installSkill(skill: DesktopSkillCatalogItem): Promise<void> {
    if (skill.installed || installingSkillIds.has(skill.id)) return
    setInstallingSkillIds(current => new Set(current).add(skill.id))
    setSkillsError(null)
    try {
      const result = await desktopClient.installSkill({
        id: skill.id,
        installUrl: skill.installUrl,
      })
      setSkills(current =>
        current.map(item =>
          item.id === result.id ? { ...item, installed: result.installed } : item,
        ),
      )
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : '技能安装失败。')
    } finally {
      setInstallingSkillIds(current => {
        const next = new Set(current)
        next.delete(skill.id)
        return next
      })
    }
  }

  function clearPluginFilters(): void {
    setPluginQuery('')
    setPluginCategory('all')
    setPluginStatus('all')
  }

  function refreshActiveCatalog(): void {
    if (tab === 'plugins') {
      refreshBuiltinPlugins()
      return
    }
    setSkillsReloadKey(current => current + 1)
  }

  return (
    <section className="plugins-view">
      <WorkspaceHeaderItem
        align="start"
        id="plugins.tabs"
        order={0}
        slot="left"
      >
        <SegmentedControl
          ariaLabel="扩展类型"
          className="plugins-segmented-tabs"
          getPanelId={value => `${value}-panel`}
          getTabId={value => `${value}-tab`}
          onChange={selectTab}
          overflowMode="fit"
          options={TAB_OPTIONS}
          semantics="tabs"
          value={tab}
        />
      </WorkspaceHeaderItem>
      <WorkspaceHeaderItem
        align="end"
        id="plugins.refresh"
        order={100}
        slot="right"
      >
        <IconButton
          aria-busy={tab === 'plugins' ? pluginsLoading : skillsLoading}
          disabled={tab === 'plugins' ? pluginsLoading : skillsLoading}
          onClick={refreshActiveCatalog}
          title={tab === 'plugins' ? '刷新插件目录' : '刷新技能目录'}
          variant="toolbar"
        >
          <RefreshCw
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </IconButton>
      </WorkspaceHeaderItem>

      <div className="plugins-scroll-region" ref={scrollRegionRef}>
        <div className="plugins-content">
          <header className="plugins-page-heading">
            <h1 className="plugins-page-title">{tab === 'plugins' ? '插件' : '技能'}</h1>
            <p className="plugins-page-description">
              {tab === 'plugins'
                ? '浏览 CodePilotX 已内置、可管理或需要外部安装的扩展能力。'
                : '从 skills.sh 搜索并添加可复用技能。'}
            </p>
          </header>

          {tab === 'plugins' ? (
            <div
              aria-labelledby="plugins-tab"
              className="plugins-panel"
              id="plugins-panel"
              role="tabpanel"
            >
              <div className="plugins-sticky-search">
                <SearchInput
                  aria-label="搜索插件"
                  className="plugins-search"
                  onChange={setPluginQuery}
                  placeholder="搜索插件"
                  value={pluginQuery}
                />
              </div>

              <section
                aria-labelledby="included-plugins-title"
                className="plugins-included-overview"
              >
                <header className="plugins-included-overview__header">
                  <h2 id="included-plugins-title">已内置</h2>
                  <span className="plugins-sr-status">
                    {includedPluginOverview.length} 个插件
                  </span>
                </header>
                <ul className="plugins-included-overview__list">
                  {includedPluginOverview.map(item => (
                    <li key={item.id}>
                      <button
                        aria-label={`查看 ${item.name} 详情`}
                        className="plugins-included-overview__item"
                        onClick={event => {
                          setDetailTrigger(event.currentTarget)
                          setSelectedPluginId(item.id)
                          setDetailOpen(true)
                        }}
                        title={item.name}
                        type="button"
                      >
                        <PluginIcon name={item.iconName} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="plugins-directory-toolbar">
                <div aria-label="插件来源" className="plugins-category-filter" role="group">
                  {CATEGORY_OPTIONS.map(option => (
                    <button
                      aria-pressed={pluginCategory === option.id}
                      className="plugins-category-option"
                      key={option.id}
                      onClick={() => setPluginCategory(option.id)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <PopoverMenu
                  align="end"
                  className="popover-menu--flex"
                  onOpenChange={setStatusMenuOpen}
                  open={statusMenuOpen}
                  trigger={
                    <IconButton
                      className="plugins-status-trigger"
                      ref={statusTriggerRef}
                      size="md"
                      title={`插件状态：${selectedStatusLabel}`}
                      variant="plain"
                    >
                      <ListFilter
                        aria-hidden="true"
                        size={APP_ICON_SIZE}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    </IconButton>
                  }
                  width="13rem"
                >
                  {STATUS_OPTIONS.map(option => (
                    <PopoverItem
                      key={option.id}
                      onClick={() => setPluginStatus(option.id)}
                      selected={pluginStatus === option.id}
                      withCheck
                    >
                      {option.label}
                    </PopoverItem>
                  ))}
                </PopoverMenu>
              </div>

              <div aria-live="polite" className="plugins-sr-status">
                {announcement}
              </div>

              {pluginLoadError ? (
                <div className="plugins-callout" data-tone="danger" role="status">
                  <AlertOctagon aria-hidden="true" size={APP_ICON_SIZE} />
                  <div>
                    <strong>无法读取可管理插件状态</strong>
                    <p>{pluginLoadError}</p>
                  </div>
                  <Button onClick={refreshBuiltinPlugins}>
                    重试
                  </Button>
                </div>
              ) : null}

              <section
                aria-busy={pluginsLoading || undefined}
                aria-label="插件目录"
                className="plugins-directory"
              >
                {pluginsLoading ? (
                  <SkeletonRegion
                    className="plugins-skeleton-grid"
                    label="正在加载插件目录"
                  >
                    {Array.from({ length: 6 }).map((_, index) => (
                      <SkeletonBlock className="plugins-skeleton" key={index} />
                    ))}
                  </SkeletonRegion>
                ) : visiblePlugins.length === 0 ? (
                  <div className="plugins-empty">
                    <Clock aria-hidden="true" size={APP_ICON_SIZE} />
                    <h3>{pluginQuery ? '没有匹配的插件' : '当前筛选没有结果'}</h3>
                    <p>
                      {pluginQuery
                        ? `没有找到与“${pluginQuery}”匹配的插件。`
                        : '清除来源或状态筛选后再试。'}
                    </p>
                    <Button onClick={clearPluginFilters}>
                      清除筛选
                    </Button>
                  </div>
                ) : (
                  <div className="plugins-source-groups">
                    {pluginGroups.map(group => (
                      <section className="plugins-source-group" key={group.category}>
                        <header className="plugins-source-group__header">
                          <h2>{group.label}</h2>
                          <span className="plugins-sr-status">{group.items.length} 项</span>
                        </header>
                        <ul className="plugins-source-group__list">
                          {group.items.map(item => (
                            <PluginCatalogRow
                              busy={busyPluginIds.has(item.id)}
                              error={pluginErrors[item.id]}
                              item={item}
                              key={item.id}
                              onOpenDetails={(plugin, trigger) => {
                                setDetailTrigger(trigger)
                                setSelectedPluginId(plugin.id)
                                setDetailOpen(true)
                              }}
                              onPrimaryAction={(plugin, trigger) => {
                                void runPluginAction(plugin, trigger)
                              }}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </section>

              <PluginDetailsDialog
                busy={selectedPlugin ? busyPluginIds.has(selectedPlugin.id) : false}
                error={selectedPlugin ? pluginErrors[selectedPlugin.id] : null}
                item={selectedPlugin}
                onOpenChange={setDetailOpen}
                onPrimaryAction={(plugin, trigger) => {
                  void runPluginAction(plugin, trigger)
                }}
                open={detailOpen && selectedPlugin !== null}
                restoreFocusElement={detailTrigger}
              />
            </div>
          ) : (
            <div
              aria-labelledby="skills-tab"
              aria-busy={skillsLoading || undefined}
              className="plugins-panel"
              id="skills-panel"
              role="tabpanel"
            >
              <div className="plugins-sticky-search">
                <SearchInput
                  aria-label="搜索技能"
                  className="plugins-search"
                  onChange={setSkillQuery}
                  placeholder="搜索技能"
                  value={skillQuery}
                />
              </div>

              {skillGroups.installed.length > 0 ? (
                <section className="plugins-source-group" aria-labelledby="installed-skills-title">
                  <header className="plugins-source-group__header">
                    <h2 id="installed-skills-title">已添加</h2>
                    <span className="plugins-sr-status">
                      {skillGroups.installed.length} 项
                    </span>
                  </header>
                  <ul className="plugins-source-group__list">
                    {skillGroups.installed.map(skill => (
                      <SkillCatalogRow
                        key={skill.id}
                        onInstall={item => void installSkill(item)}
                        skill={skill}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              <div aria-label="技能来源" className="plugins-skill-owner-filter" role="group">
                {SKILL_OWNER_OPTIONS.map(option => (
                  <button
                    aria-pressed={skillOwner === option.id}
                    className="plugins-category-option"
                    key={option.id}
                    onClick={() => setSkillOwner(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {skillsError && skills.length > 0 ? (
                <div className="plugins-callout" data-tone="danger" role="status">
                  <AlertOctagon aria-hidden="true" size={APP_ICON_SIZE} />
                  <div>
                    <strong>技能目录刷新失败</strong>
                    <p>{skillsError}</p>
                  </div>
                  <Button
                    onClick={() => setSkillsReloadKey(current => current + 1)}
                  >
                    重试
                  </Button>
                </div>
              ) : null}

              {skillsError && skills.length === 0 ? (
                <div className="plugins-empty">
                  <AlertOctagon aria-hidden="true" size={APP_ICON_SIZE} />
                  <p>{skillsError}</p>
                  <ol className="plugins-empty-steps">
                    <li>在 Vercel 项目中启用 OIDC Federation。</li>
                    <li>用该项目提供的 VERCEL_OIDC_TOKEN 启动 CodePilotX。</li>
                    <li>重启应用后重新加载 skills.sh 技能目录。</li>
                  </ol>
                  <div className="plugins-empty-actions">
                    <Button onClick={() => setSkillsReloadKey(current => current + 1)}>
                      重试
                    </Button>
                    <Button
                      onClick={() => void desktopClient.openExternalURL('https://skills.sh')}
                    >
                      打开 skills.sh
                    </Button>
                    <Button
                      onClick={() => void desktopClient.openExternalURL(SKILLS_SH_API_DOCS_URL)}
                    >
                      查看配置文档
                    </Button>
                  </div>
                </div>
              ) : skillsLoading && skills.length === 0 ? (
                <SkeletonRegion
                  className="plugins-skeleton-grid"
                  label="正在加载 skills.sh 技能目录"
                >
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div
                      aria-hidden="true"
                      className="skill-catalog-row plugins-skill-skeleton"
                      key={index}
                    >
                      <SkeletonBlock className="plugins-skill-skeleton__icon" />
                      <span className="plugins-skill-skeleton__content">
                        <SkeletonBlock className="plugins-skill-skeleton__title" />
                        <SkeletonBlock className="plugins-skill-skeleton__meta" />
                      </span>
                      <SkeletonBlock className="plugins-skill-skeleton__action" />
                    </div>
                  ))}
                </SkeletonRegion>
              ) : skillGroups.installed.length === 0 && skillGroups.recommended.length === 0 ? (
                <div className="plugins-empty">
                  <Clock aria-hidden="true" size={APP_ICON_SIZE} />
                  <p>
                    {skillQuery
                      ? `没有匹配“${skillQuery}”的技能。`
                      : '当前来源没有可展示的技能。'}
                  </p>
                </div>
              ) : (
                <section className="plugins-source-group" aria-labelledby="recommended-skills-title">
                  <header className="plugins-source-group__header">
                    <h2 id="recommended-skills-title">推荐</h2>
                    <span className="plugins-sr-status">
                      {skillGroups.recommended.length} 项
                    </span>
                  </header>
                  {skillGroups.recommended.length > 0 ? (
                    <ul className="plugins-source-group__list">
                      {skillGroups.recommended.map(skill => (
                        <SkillCatalogRow
                          installing={installingSkillIds.has(skill.id)}
                          key={skill.id}
                          onInstall={item => void installSkill(item)}
                          skill={skill}
                        />
                      ))}
                    </ul>
                  ) : (
                    <div className="plugins-empty plugins-empty--section">
                      <p>当前来源没有可添加的推荐技能。</p>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
