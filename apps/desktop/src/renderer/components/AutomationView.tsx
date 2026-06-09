import type React from 'react'

export function AutomationView(): React.ReactNode {
  return (
    <section className="utility-view">
      <div className="utility-view-header">
        <span className="section-label">自动化</span>
        <h1>自动化中心</h1>
        <p>这里将承接桌面端自动化任务、提醒、监控与运行记录。</p>
      </div>
      <div className="utility-card placeholder-card">
        <h2>暂未接入自动化后端</h2>
        <p>后续可以在这里列出自动化任务、执行历史和状态订阅能力。</p>
      </div>
    </section>
  )
}
