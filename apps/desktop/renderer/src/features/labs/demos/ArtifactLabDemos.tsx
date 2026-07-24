import { useState } from 'react'
import { FileText, Sparkles } from 'lucide-react'
import { DemoSurface } from './DemoSurface.js'

export function ArtifactEditorDemo() {
  const [selected, setSelected] = useState(false)
  return (
    <DemoSurface className="lab-artifact">
      <div className="lab-artifact-toolbar"><button type="button" onClick={() => setSelected(value => !value)}><Sparkles aria-hidden /> Magic Edit</button></div>
      <div className="ProseMirror" data-selected={selected}>
        <h3>产品说明草稿</h3><p>这是一个根据构建产物近似重建的富文本编辑表面。</p>
        <table><tbody><tr><th>状态</th><th>主题</th></tr><tr><td>原型</td><td>动态</td></tr></tbody></table>
      </div>
    </DemoSurface>
  )
}

export function ArtifactMarkdownDemo() {
  return (
    <DemoSurface className="lab-markdown">
      <h2>Artifact Markdown</h2><blockquote>语义令牌会同时驱动正文、代码和宽媒体块。</blockquote>
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

export function RemoteTextDemo() {
  return <DemoSurface className="lab-remote-text"><article><h2>Project brief</h2><p>This preview uses a metric-compatible document surface.</p><ol><li>Preserve pagination</li><li>Preserve table width</li><li>Preserve line breaks</li></ol></article></DemoSurface>
}
