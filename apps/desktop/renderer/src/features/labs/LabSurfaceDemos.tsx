import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  FileText,
  Mic,
  Play,
  Search,
  Sparkles,
  Square,
  UserRound,
} from 'lucide-react'

function DemoSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`lab-surface ${className}`}>{children}</div>
}

export function AvatarOverlayDemo() {
  const [resizing, setResizing] = useState(false)
  return (
    <DemoSurface className="lab-avatar-scene">
      <div className="lab-avatar" data-resizing={resizing} aria-label="像素鲸鱼 Avatar">
        <span>◕‿◕</span>
      </div>
      <div className="lab-avatar-pill">
        <Sparkles aria-hidden />
        <span>正在整理上下文</span>
        <button type="button" onClick={() => setResizing(value => !value)}>
          {resizing ? '完成' : '调整'}
        </button>
      </div>
    </DemoSurface>
  )
}

export function GlobalDictationDemo() {
  const [expanded, setExpanded] = useState(false)
  return (
    <DemoSurface className="lab-dictation" >
      <button className="lab-dictation-orb" type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
        <Mic aria-hidden />
      </button>
      <div className="lab-dictation-copy" data-expanded={expanded}>
        <strong>{expanded ? '听写窗口已展开' : '全局听写'}</strong>
        <span>视觉状态演示，不会请求麦克风权限</span>
      </div>
    </DemoSurface>
  )
}

export function ModelPickerDemo() {
  const [level, setLevel] = useState(64)
  const [fast, setFast] = useState(true)
  return (
    <DemoSurface className="lab-model-picker">
      <div className="lab-demo-row"><strong>GPT-5.6 Codex</strong><span>推理强度 {level}%</span></div>
      <input aria-label="推理强度" type="range" min="0" max="100" value={level} onChange={event => setLevel(Number(event.target.value))} />
      <div className="lab-slider-ticks" aria-hidden><i /><i /><i /><i /><i /></div>
      <button type="button" data-selected={fast} onClick={() => setFast(value => !value)}>⚡ Fast Mode</button>
      {level > 85 ? <p className="lab-ultra-warning">Ultra 会使用更多额度</p> : null}
    </DemoSurface>
  )
}

export function ArtifactEditorDemo() {
  const [selected, setSelected] = useState(false)
  return (
    <DemoSurface className="lab-artifact">
      <div className="lab-artifact-toolbar"><button type="button" onClick={() => setSelected(value => !value)}><Sparkles aria-hidden /> Magic Edit</button></div>
      <div className="ProseMirror" data-selected={selected}>
        <h3>产品说明草稿</h3>
        <p>这是一个根据构建产物近似重建的富文本编辑表面。</p>
        <table><tbody><tr><th>状态</th><th>主题</th></tr><tr><td>原型</td><td>动态</td></tr></tbody></table>
      </div>
    </DemoSurface>
  )
}

export function ArtifactMarkdownDemo() {
  return (
    <DemoSurface className="lab-markdown">
      <h2>Artifact Markdown</h2>
      <blockquote>语义令牌会同时驱动正文、代码和宽媒体块。</blockquote>
      <pre><code>{'const theme = deriveCodexPalette(config)'}</code></pre>
      <div className="lab-mermaid" data-mermaid-overflow="false">Theme → Token → Component</div>
      <span className="lab-file-reference"><FileText aria-hidden /> themeVariables.ts</span>
    </DemoSurface>
  )
}

export function PdfPreviewDemo() {
  return (
    <DemoSurface className="lab-pdf">
      <div className="lab-pdf-page">
        <div className="lab-pdf-canvas" aria-hidden />
        <div className="textLayer"><h3>Theme System</h3><p>Selectable text layer · Page 1</p></div>
        <div className="annotationLayer"><a href="#pdf-note">查看注释</a></div>
      </div>
    </DemoSurface>
  )
}

export function PresentationDemo() {
  const [stacked, setStacked] = useState(false)
  return (
    <DemoSurface className="lab-presentation" data-layout={stacked ? 'stacked' : 'rail'}>
      <div className="lab-slide-rail">{[1, 2, 3].map(item => <button type="button" key={item}>{item}</button>)}</div>
      <div className="lab-slide"><small>CODEPILOTX</small><h2>Design tokens that travel</h2><p>Surface · Ink · Accent · Contrast</p></div>
      <button className="lab-layout-toggle" type="button" onClick={() => setStacked(value => !value)}>切换布局</button>
    </DemoSurface>
  )
}

export function TerminalDemo() {
  return (
    <DemoSurface className="xterm lab-terminal" data-codex-xterm>
      <div className="xterm-screen" role="log" aria-live="polite">
        <p><span className="ansi-green">➜</span> <span className="ansi-blue">CodePilotX</span> bun run dev</p>
        <p><span className="ansi-dim">renderer</span> ready at <span className="ansi-cyan">127.0.0.1:7788</span></p>
        <p><span className="lab-terminal-caret" aria-hidden>▋</span></p>
      </div>
    </DemoSurface>
  )
}

export function ChartsMapsDemo() {
  return (
    <DemoSurface className="lab-data-viz">
      <div className="lab-chart" aria-label="离线柱状图">{[42, 72, 55, 88, 64].map((value, index) => <i key={index} style={{ '--lab-value': `${value}%` } as CSSProperties} />)}</div>
      <div className="mapboxgl-map lab-map" aria-label="离线地图骨架"><span>F:\CodeProject</span><i /><i /><i /></div>
    </DemoSurface>
  )
}

export function HotkeyWindowDemo() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <DemoSurface className="lab-hotkey-window" data-menu-open={menuOpen}>
      <div className="lab-hotkey-tray"><span>⌘ K</span><strong>快速对话</strong></div>
      <div className="lab-hotkey-composer"><input readOnly placeholder="交给 CodePilotX…" /><button type="button" onClick={() => setMenuOpen(value => !value)}><ChevronDown aria-hidden /></button></div>
      {menuOpen ? <div className="lab-hotkey-menu">本地工作区<br />Cloud environment</div> : null}
    </DemoSurface>
  )
}

export function CommandMenuDemo() {
  const [query, setQuery] = useState('')
  const commands = ['新建会话', '打开模型中心', '切换深色主题', '管理进程']
  return (
    <DemoSurface className="lab-command-menu" data-cmdk-root>
      <label><Search aria-hidden /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="输入命令…" /></label>
      <div data-cmdk-list>{commands.filter(item => item.includes(query)).map((item, index) => <button type="button" data-cmdk-item data-selected={index === 0} key={item}>{item}<kbd>↵</kbd></button>)}</div>
    </DemoSurface>
  )
}

export function MicroBridgeDemo() {
  const [selected, setSelected] = useState(false)
  return <DemoSurface className="lab-micro"><button type="button" data-composer-navigation-highlight data-selected={selected} onClick={() => setSelected(value => !value)}>{selected ? <Check aria-hidden /> : <Sparkles aria-hidden />} Composer action</button></DemoSurface>
}

export function ThreadRailDemo() {
  const [target, setTarget] = useState(2)
  return (
    <DemoSurface className="lab-thread-rail" data-scrubbing>
      <div className="lab-message-preview">用户消息 {target + 1}<small>拖动轨道快速跳转</small></div>
      <input aria-label="消息位置" type="range" min="0" max="5" value={target} onChange={event => setTarget(Number(event.target.value))} />
      <div className="lab-rail-markers">{[0, 1, 2, 3, 4, 5].map(index => <i key={index} data-current={index === target} style={{ '--marker-distance': Math.abs(index - target) } as CSSProperties} />)}</div>
    </DemoSurface>
  )
}

export function ProfileDemo() {
  const [loading, setLoading] = useState(true)
  return (
    <DemoSurface className="lab-profile">
      <div className="lab-profile-avatar">{loading ? null : <UserRound aria-hidden />}<span>✎</span></div>
      <div className={loading ? 'lab-profile-copy is-loading' : 'lab-profile-copy'}><strong>{loading ? '加载资料' : 'CodePilotX User'}</strong><p>{loading ? '同步账户信息…' : 'Windows desktop · Local workspace'}</p></div>
      <button type="button" onClick={() => setLoading(value => !value)}>切换状态</button>
    </DemoSurface>
  )
}

export function RemoteTextDemo() {
  return <DemoSurface className="lab-remote-text"><article><h2>Project brief</h2><p>This preview uses a metric-compatible document surface.</p><ol><li>Preserve pagination</li><li>Preserve table width</li><li>Preserve line breaks</li></ol></article></DemoSurface>
}

export function MotionGalleryDemo() {
  return (
    <DemoSurface className="lab-motion-grid">
      <div className="lab-shimmer">Cadenced shimmer</div>
      <div className="lab-working-dots"><i /><i /><i /></div>
      <div className="lab-status-pill"><Play aria-hidden /> Running</div>
      <div className="lab-bloom"><Sparkles aria-hidden /></div>
    </DemoSurface>
  )
}

export function LayoutSurfacesDemo() {
  const [columns, setColumns] = useState(2)
  return (
    <DemoSurface className="lab-layout-surfaces" data-columns={columns}>
      <header>App shell frame <button type="button" onClick={() => setColumns(value => value === 2 ? 1 : 2)}>{columns} 列</button></header>
      <aside>Sidebar<br /><small>Header fade</small></aside>
      <main>Thread content frame<div className="lab-floating-composer">Floating composer</div></main>
    </DemoSurface>
  )
}

export function FormControlsDemo() {
  const [color, setColor] = useState('#339cff')
  const [number, setNumber] = useState(45)
  return (
    <DemoSurface className="lab-form-controls">
      <label>Contrast<input type="number" min="0" max="100" value={number} onChange={event => setNumber(Number(event.target.value))} /></label>
      <label>Accent<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
      <label>Strength<input type="range" min="0" max="100" value={number} onChange={event => setNumber(Number(event.target.value))} /></label>
      <div className="lab-tooltip-anchor"><button type="button"><Square aria-hidden /> Focus target</button><span data-side="top">Tooltip positioner</span></div>
    </DemoSurface>
  )
}
