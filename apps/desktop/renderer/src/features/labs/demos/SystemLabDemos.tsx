import { useState } from 'react'
import { Play, Sparkles, Square, UserRound } from 'lucide-react'
import { DemoSurface } from './DemoSurface.js'

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
