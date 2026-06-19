import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertOctagon,
  Bell,
  Check,
  ChevronDown,
  Clock,
  Eye,
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
  Sparkles,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './ui/iconTokens.js'
import { desktopClient } from '../services/desktopClient.js'
import { IconButton } from './ui/IconButton.js'

type PluginTone = 'github' | 'chrome' | 'sheet' | 'slides' | 'slack' | 'data' | 'design' | 'creative' | 'sales' | 'codex'

type Plugin = {
  id: string
  builtinPluginId?: string
  name: string
  description: string
  icon: React.ReactNode
  tone: PluginTone
  installed: boolean
}

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
    builtinPluginId: 'minimax@builtin',
    name: 'MiniMax Media',
    description: 'Generate images, speech, video, and music with MiniMax',
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
type Owner = 'openai' | 'all' | 'community'
type Tab = 'plugins' | 'skills'

export function PluginsView(): React.ReactNode {
  const [tab, setTab] = useState<Tab>('plugins')
  const [activeSlide, setActiveSlide] = useState(1)
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState<Owner>('openai')
  const [filter, setFilter] = useState<Filter>('all')
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

  async function enablePlugin(plugin: Plugin): Promise<void> {
    if (!plugin.builtinPluginId) return
    const result = await desktopClient.setBuiltinPluginEnabled(
      plugin.builtinPluginId,
      true,
    )
    setEnabledBuiltinPlugins(current => ({
      ...current,
      [result.id]: result.enabled,
    }))
  }

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
        <h1>让 CodePilotX 按你的方式工作</h1>
      </div>

      <div className="plugins-search-row">
        <label className="plugins-search">
          <Search size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <input
            value={query}
            placeholder="搜索插件"
            onChange={event => setQuery(event.target.value)}
          />
        </label>

        <button className="plugins-filter" type="button">
          <span className="plugins-filter-owner">
            <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            Built by OpenAI
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
              Computer Use
            </code>
            播放一个播放列表,帮我进入专注状态
          </p>
          <button className="plugins-hero-cta" type="button">
            <MessageSquare size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            在对话中试用
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
          <h2>Featured</h2>
          <span className="plugins-section-count">{visiblePlugins.length}</span>
        </header>

        {visiblePlugins.length === 0 ? (
          <div className="plugins-empty">
            <Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <p>没有匹配 "{query}" 的插件。</p>
          </div>
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
                  disabled={plugin.installed}
                  onClick={() => { void enablePlugin(plugin) }}
                  type="button"
                  title={plugin.installed ? '已添加' : '添加到 CodePilotX'}
                >
                  {plugin.installed ? <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} /> : <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}


