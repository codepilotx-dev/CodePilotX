import { useState, type CSSProperties } from 'react'
import { Check, Mic, Sparkles } from 'lucide-react'
import { DemoSurface } from './DemoSurface.js'

export function AvatarOverlayDemo() {
  const [resizing, setResizing] = useState(false)
  return (
    <DemoSurface className="lab-avatar-scene">
      <div className="lab-avatar" data-resizing={resizing} aria-label="像素鲸鱼 Avatar"><span>◕‿◕</span></div>
      <div className="lab-avatar-pill">
        <Sparkles aria-hidden /><span>正在整理上下文</span>
        <button type="button" onClick={() => setResizing(value => !value)}>{resizing ? '完成' : '调整'}</button>
      </div>
    </DemoSurface>
  )
}

export function GlobalDictationDemo() {
  const [expanded, setExpanded] = useState(false)
  return (
    <DemoSurface className="lab-dictation">
      <button className="lab-dictation-orb" type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}><Mic aria-hidden /></button>
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
