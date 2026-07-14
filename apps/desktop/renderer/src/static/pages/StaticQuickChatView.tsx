import type React from 'react'
import { Mic, Paperclip, Plus, Send, SlidersHorizontal, Sparkles } from 'lucide-react'

export function StaticQuickChatView(): React.ReactNode {
  return (
    <div className="quick-chat-workspace">
      <div className="quick-chat-view">
        <div className="quick-chat-hero">
          <h1>
            我们应该在 <button className="project-name" type="button">CodePilotX-Ts</button> 中构建什么？
          </h1>
        </div>
        <div className="chat-composer">
          <StaticComposer placeholder="描述一次静态 UI 迁移任务" />
        </div>
      </div>
    </div>
  )
}

export function StaticComposer({ placeholder = '输入消息' }: { placeholder?: string }): React.ReactNode {
  return (
    <section className="composer" aria-label="静态输入框">
      <div className="composer-top">
        <div className="composer-input">
          <textarea placeholder={placeholder} defaultValue="" rows={3} readOnly />
        </div>
        <div className="composer-toolbar">
          <div className="toolbar-left">
            <button className="icon-button" type="button" disabled aria-label="添加">
              <Plus size={16} />
            </button>
            <button className="icon-button" type="button" disabled aria-label="附件">
              <Paperclip size={16} />
            </button>
            <span className="composer-skill-token">
              <span className="composer-skill-token-icon"><Sparkles size={14} /></span>
              <span className="composer-skill-token-label">static-ui</span>
            </span>
          </div>
          <div className="toolbar-right">
            <button className="composer-mic-button icon-button" type="button" disabled aria-label="语音">
              <Mic size={16} />
            </button>
            <button className="icon-button" type="button" disabled aria-label="参数">
              <SlidersHorizontal size={16} />
            </button>
            <button className="send-button icon-button" type="button" disabled aria-label="发送">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="composer-bottom">
        <button className="chip-button composer-model-chip" type="button" disabled>
          <span className="composer-model-chip-label">GPT-5.6 Sol</span>
          <span className="composer-model-chip-thinking">静态</span>
        </button>
        <button className="composer-plan-mode-chip active" type="button" disabled>
          <span className="composer-plan-mode-chip-icon composer-plan-mode-chip-icon-plan"><Sparkles size={14} /></span>
          <span>计划模式</span>
        </button>
      </div>
    </section>
  )
}
