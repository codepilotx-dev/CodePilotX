import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertOctagon,
  Bell,
  Check,
  ChevronDown,
  Clock,
  Eye,
  ExternalLink,
  FileSpreadsheet,
  GitBranch,
  MessageCircle,
  MessageSquare,
  Palette,
  PencilRuler,
  PlayCircle,
  Plus,
  Search,
  Settings2,
  Share2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktopClient.js'
import { IconButton } from '../../components/ui/IconButton.js'
import type {
  DesktopSkillAuditStatus,
  DesktopSkillCatalogItem,
  DesktopSkillOwnerFilter,
} from '../../../shared/types.js'

type PluginTone = 'github' | 'chrome' | 'sheet' | 'slides' | 'slack' | 'data' | 'design' | 'creative' | 'sales' | 'codex'

type Plugin = {
  id: string
  builtinPluginId?: string
  externalURL?: string
  name: string
  description: string
  icon: React.ReactNode
  tone: PluginTone
  installed: boolean
}

const MINIMAX_CLI_DOCS_URL = 'https://platform.minimax.io/docs/token-plan/minimax-cli'

const PLUGINS: Plugin[] = [
  {
    id: 'computer-use',
    name: 'Computer Use',
    description: 'Control Windows apps from CodePilotX',
    icon: <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'codex',
    installed: true,
  },
  {
    id: 'chrome',
    name: 'Chrome',
    description: 'Control Chrome with CodePilotX',
    icon: <Eye size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'chrome',
    installed: true,
  },
  {
    id: 'spreadsheets',
    name: 'Spreadsheets',
    description: 'Create and edit spreadsheet files',
    icon: <FileSpreadsheet size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'sheet',
    installed: true,
  },
  {
    id: 'presentations',
    name: 'Presentations',
    description: 'Create and edit presentations',
    icon: <Share2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'slides',
    installed: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Triage PRs, issues, CI, and publish flows',
    icon: <GitBranch size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'github',
    installed: true,
  },
  {
    id: 'minimax',
    externalURL: MINIMAX_CLI_DOCS_URL,
    name: 'MiniMax',
    description: 'Install the official MiniMax CLI for media, vision, speech, music, and quota workflows',
    icon: <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'creative',
    installed: false,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and manage Slack',
    icon: <MessageCircle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'slack',
    installed: false,
  },
  {
    id: 'data-analytics',
    name: 'Data Analytics',
    description: 'Turn data into clear decisions',
    icon: <AlertOctagon size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'data',
    installed: false,
  },
  {
    id: 'product-design',
    name: 'Product Design',
    description: 'Explore and prototype ideas',
    icon: <PencilRuler size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'design',
    installed: false,
  },
  {
    id: 'creative-production',
    name: 'Creative Production',
    description: 'Create marketing visuals from a brief or...',
    icon: <Palette size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'creative',
    installed: false,
  },
  {
    id: 'sales',
    name: 'Sales',
    description: 'Prepare sales work faster',
    icon: <Bell size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
    tone: 'sales',
    installed: false,
  },
]

const HERO_SLIDES = 5

type Filter = 'all' | 'installed' | 'available'
type Tab = 'plugins' | 'skills'

export function PluginsView(): React.ReactNode {
  const [tab, setTab] = useState<Tab>('plugins')
  const [activeSlide, setActiveSlide] = useState(1)
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState<DesktopSkillOwnerFilter>('official')
  const [filter, setFilter] = useState<Filter>('all')
  const [skills, setSkills] = useState<DesktopSkillCatalogItem[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillsReloadKey, setSkillsReloadKey] = useState(0)
  const [installingSkillIds, setInstallingSkillIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [enabledBuiltinPlugins, setEnabledBuiltinPlugins] = useState<
    Record<string, boolean>
  >({})

  useEffect(() => {
    let cancelled = false
    desktopClient
      .listBuiltinPlugins()
      .then(plugins => {
        if (cancelled) return
        setEnabledBuiltinPlugins(
          Object.fromEntries(plugins.map(plugin => [plugin.id, plugin.enabled])),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setEnabledBuiltinPlugins({})
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (tab !== 'skills') return
    let cancelled = false
    setSkillsLoading(true)
    setSkillsError(null)
    desktopClient
      .listSkillsCatalog({
        query,
        owner,
        view: 'trending',
        page: 0,
        perPage: 24,
      })
      .then(result => {
        if (cancelled) return
        setSkills(result.skills)
      })
      .catch(error => {
        if (cancelled) return
        setSkills([])
        setSkillsError(
          error instanceof Error ? error.message : '技能目录加载失败。',
        )
      })
      .finally(() => {
        if (!cancelled) {
          setSkillsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [owner, query, skillsReloadKey, tab])

  const visiblePlugins = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return PLUGINS.map(plugin => ({
      ...plugin,
      installed: plugin.builtinPluginId
        ? enabledBuiltinPlugins[plugin.builtinPluginId] === true
        : plugin.installed,
    })).filter(plugin => {
      if (filter === 'installed' && !plugin.installed) return false
      if (filter === 'available' && plugin.installed) return false
      if (!keyword) return true
      return (
        plugin.name.toLowerCase().includes(keyword) ||
        plugin.description.toLowerCase().includes(keyword)
      )
    })
  }, [enabledBuiltinPlugins, filter, query])

  const visibleSkills = useMemo(() => {
    return skills.filter(skill => {
      if (filter === 'installed' && !skill.installed) return false
      if (filter === 'available' && skill.installed) return false
      return true
    })
  }, [filter, skills])

  async function activatePlugin(plugin: Plugin): Promise<void> {
    if (plugin.externalURL) {
      await desktopClient.openExternalURL(plugin.externalURL)
      return
    }
    if (!plugin.builtinPluginId) return
    const result = await desktopClient.setBuiltinPluginEnabled(
      plugin.builtinPluginId,
      !plugin.installed,
    )
    setEnabledBuiltinPlugins(current => ({
      ...current,
      [result.id]: result.enabled,
    }))
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
          item.id === result.id
            ? { ...item, installed: result.installed }
            : item,
        ),
      )
    } catch (error) {
      setSkillsError(
        error instanceof Error ? error.message : '技能安装失败。',
      )
    } finally {
      setInstallingSkillIds(current => {
        const next = new Set(current)
        next.delete(skill.id)
        return next
      })
    }
  }

  const isSkillsTab = tab === 'skills'
  const listCount = isSkillsTab ? visibleSkills.length : visiblePlugins.length

  return (
    <section className="plugins-view">
      <header className="plugins-toolbar">
        <div className="plugins-tabs">
          <button
            aria-pressed={tab === 'plugins'}
            className={tab === 'plugins' ? 'plugins-tab is-active' : 'plugins-tab'}
            onClick={() => setTab('plugins')}
            type="button"
          >
            插件
          </button>
          <button
            aria-pressed={tab === 'skills'}
            className={tab === 'skills' ? 'plugins-tab is-active' : 'plugins-tab'}
            onClick={() => setTab('skills')}
            type="button"
          >
            技能
          </button>
        </div>

        <div className="plugins-actions">
          <button className="plugins-button is-ghost" type="button">
            <Settings2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <span>管理</span>
          </button>
          <button className="plugins-button is-primary" type="button">
            <span>创建</span>
            <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </button>
          <IconButton title="更多操作">
            <span className="plugins-more-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </IconButton>
        </div>
      </header>

      <div className="plugins-hero-header">
        <h1>{isSkillsTab ? '从 skills.sh 添加可复用技能' : '让 CodePilotX 按你的方式工作'}</h1>
      </div>

      <div className="plugins-search-row">
        <label className="plugins-search">
          <Search size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <input
            value={query}
            placeholder={isSkillsTab ? '搜索技能' : '搜索插件'}
            onChange={event => setQuery(event.target.value)}
          />
        </label>

        <button
          className="plugins-filter"
          onClick={() => {
            if (!isSkillsTab) return
            setOwner(current =>
              current === 'official'
                ? 'all'
                : current === 'all'
                ? 'community'
                : 'official',
            )
          }}
          type="button"
        >
          <span className="plugins-filter-owner">
            <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            {isSkillsTab
              ? owner === 'official'
                ? 'Official'
                : owner === 'community'
                ? 'Community'
                : 'All skills'
              : 'Built by OpenAI'}
          </span>
          <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </button>

        <button
          aria-expanded={filter !== 'all'}
          className="plugins-filter"
          onClick={() =>
            setFilter(current =>
              current === 'all' ? 'installed' : current === 'installed' ? 'available' : 'all',
            )
          }
          type="button"
        >
          <span>
            {filter === 'installed'
              ? '已添加'
              : filter === 'available'
              ? '未添加'
              : '全部'}
          </span>
          <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </button>
      </div>

      <div className="plugins-hero">
        <div className="plugins-hero-aurora" aria-hidden="true" />
        <div className="plugins-hero-grain" aria-hidden="true" />
        <div className="plugins-hero-content">
          <p className="plugins-hero-pill">
            <code className="plugins-hero-command">
              <PlayCircle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              {isSkillsTab ? 'skills.sh' : 'Computer Use'}
            </code>
            {isSkillsTab ? '搜索、安装并在对话中调用专业技能' : '播放一个播放列表,帮我进入专注状态'}
          </p>
          <button
            className="plugins-hero-cta"
            onClick={() => {
              if (isSkillsTab) {
                void desktopClient.openExternalURL('https://skills.sh')
              }
            }}
            type="button"
          >
            <MessageSquare size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            {isSkillsTab ? '打开 skills.sh' : '在对话中试用'}
          </button>
        </div>

        <ol className="plugins-hero-dots" aria-label="Hero 翻页">
          {Array.from({ length: HERO_SLIDES }).map((_, index) => (
            <li
              aria-current={activeSlide === index + 1}
              className={
                activeSlide === index + 1
                  ? 'plugins-hero-dot is-active'
                  : 'plugins-hero-dot'
              }
              key={index}
              onClick={() => setActiveSlide(index + 1)}
            >
              <button
                aria-label={`第 ${index + 1} 张`}
                onClick={() => setActiveSlide(index + 1)}
                type="button"
              />
            </li>
          ))}
        </ol>
      </div>

      <section className="plugins-section">
        <header className="plugins-section-header">
          <h2>{isSkillsTab ? 'Skills' : 'Featured'}</h2>
          <span className="plugins-section-count">{listCount}</span>
        </header>

        {isSkillsTab && skillsError ? (
          <div className="plugins-empty">
            <AlertOctagon size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <p>{skillsError}</p>
            <div className="plugins-empty-actions">
              <button
                className="plugins-button is-primary"
                onClick={() => setSkillsReloadKey(current => current + 1)}
                type="button"
              >
                重试
              </button>
              <button
                className="plugins-button is-ghost"
                onClick={() => {
                  void desktopClient.openExternalURL('https://skills.sh')
                }}
                type="button"
              >
                打开 skills.sh
              </button>
            </div>
          </div>
        ) : isSkillsTab && skillsLoading ? (
          <div className="plugins-empty">
            <Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <p>正在加载 skills.sh 技能目录...</p>
          </div>
        ) : listCount === 0 ? (
          <div className="plugins-empty">
            <Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <p>没有匹配 "{query}" 的{isSkillsTab ? '技能' : '插件'}。</p>
          </div>
        ) : isSkillsTab ? (
          <ul className="plugins-grid">
            {visibleSkills.map(skill => {
              const installing = installingSkillIds.has(skill.id)
              return (
                <li className="plugins-card" data-tone="codex" key={skill.id}>
                  <span className="plugins-card-icon plugins-tone-codex">
                    <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  </span>
                  <div className="plugins-card-meta">
                    <div className="plugins-card-title-row">
                      <h3>{skill.name}</h3>
                      {skill.audit ? (
                        <span
                          className={`plugins-audit-badge is-${skill.audit.status}`}
                          title={skill.audit.summary}
                        >
                          {renderAuditIcon(skill.audit.status)}
                          {skill.audit.status}
                        </span>
                      ) : null}
                    </div>
                    <p>{skill.source} · {skill.installs.toLocaleString()} installs</p>
                  </div>
                  <button
                    aria-pressed={skill.installed}
                    className={
                      skill.installed
                        ? 'plugins-card-action is-installed'
                        : 'plugins-card-action'
                    }
                    disabled={skill.installed || installing}
                    onClick={() => { void installSkill(skill) }}
                    type="button"
                    title={skill.installed ? '已添加' : '添加到 CodePilotX'}
                  >
                    {skill.installed || installing ? <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} /> : <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <ul className="plugins-grid">
            {visiblePlugins.map(plugin => (
              <li className="plugins-card" data-tone={plugin.tone} key={plugin.id}>
                <span className={`plugins-card-icon plugins-tone-${plugin.tone}`}>
                  {plugin.icon}
                </span>
                <div className="plugins-card-meta">
                  <h3>{plugin.name}</h3>
                  <p>{plugin.description}</p>
                </div>
                <button
                  aria-pressed={plugin.installed}
                  className={
                    plugin.installed
                      ? 'plugins-card-action is-installed'
                      : 'plugins-card-action'
                  }
                  disabled={plugin.installed && !plugin.builtinPluginId}
                  onClick={() => { void activatePlugin(plugin) }}
                  type="button"
                  title={
                    plugin.externalURL
                      ? '打开 MiniMax CLI 官方文档'
                      : plugin.installed
                      ? plugin.builtinPluginId
                        ? '从 CodePilotX 移除'
                        : '已添加'
                      : '添加到 CodePilotX'
                  }
                >
                  {plugin.externalURL ? <ExternalLink size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} /> : plugin.installed ? <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} /> : <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}

function renderAuditIcon(status: DesktopSkillAuditStatus): React.ReactNode {
  if (status === 'pass') {
    return <ShieldCheck size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
  }
  if (status === 'warn') {
    return <ShieldAlert size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
  }
  return <ShieldX size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
}

