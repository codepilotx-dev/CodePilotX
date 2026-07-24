import type { CSSProperties } from 'react'
import { DemoSurface } from './DemoSurface.js'

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
