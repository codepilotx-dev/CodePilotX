import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { DemoSurface } from './DemoSurface.js'

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
