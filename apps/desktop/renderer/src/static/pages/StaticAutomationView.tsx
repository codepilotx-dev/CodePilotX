import type React from 'react'
import { Cloud, Plus, Sparkles, Workflow } from 'lucide-react'
import { staticAutomationPrompts } from '../fixtures'

export function StaticAutomationView(): React.ReactNode {
  return (
    <section className="automation-view">
      <header className="automation-header">
        <div className="automation-header-meta">
          <h1>自动化</h1>
          <p>静态任务模板展示。</p>
        </div>
        <div className="automation-header-actions">
          <button className="automation-button is-ghost" type="button" disabled>导入</button>
          <button className="automation-button is-primary" type="button" disabled><Plus size={15} />新建</button>
        </div>
      </header>
      <div className="automation-canvas">
        <div className="automation-empty-state">
          <div className="automation-cloud">
            <Cloud size={96} />
            <span className="automation-cloud-prompt"><Workflow size={24} /></span>
          </div>
          <h2 className="automation-empty-title">自动化画布</h2>
        </div>
        <ul className="automation-quick-starts">
          {staticAutomationPrompts.map(prompt => (
            <li key={prompt}>
              <button className="automation-quick-button" type="button" disabled>
                <span className="automation-quick-icon"><Sparkles size={16} /></span>
                {prompt}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
