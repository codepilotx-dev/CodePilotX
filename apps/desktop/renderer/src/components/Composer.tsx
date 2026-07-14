import type { ModelRef, ProviderInfo } from '@codepilotx/shared'
import { Mic, Paperclip, Plus, Send, Square } from 'lucide-react'
import { useState } from 'react'
import type { SendStrategy, TaskMode, TaskPhase } from '../domain/task-flow'
import { ModelSelector } from './ModelSelector'

interface ComposerProps {
  phase: TaskPhase
  taskMode: TaskMode
  strategy: SendStrategy
  model: ModelRef | null
  providers: readonly ProviderInfo[]
  disabled?: boolean
  onTaskModeChange: (mode: TaskMode) => void
  onStrategyChange: (strategy: SendStrategy) => void
  onModelChange: (model: ModelRef) => void
  onSend: (value: string) => void
  onStop: () => void
}

export function Composer({ phase, taskMode, strategy, model, providers, disabled, onTaskModeChange, onStrategyChange, onModelChange, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState('')
  const isRunning = phase === 'running' || phase === 'waiting-permission'
  const submit = () => {
    const nextValue = value.trim()
    if (!nextValue || disabled || !model) return
    onSend(nextValue)
    setValue('')
  }

  return (
    <div className="composer-wrap">
      <div className="composer" role="form" aria-label="发送消息">
        <textarea
          value={value}
          rows={2}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
          }}
          placeholder={disabled ? '正在连接 Agent…' : phase === 'waiting-question' ? '普通输入会加入等待队列；请在问题卡中回答当前问题' : isRunning ? '可以继续补充要求…' : '随心输入'}
          aria-label="消息内容"
        />
        <div className="composer-toolbar">
          <button className="icon-button" aria-label="添加附件"><Plus size={19} /></button>
          <button
            className={`plan-mode-chip ${taskMode === 'plan' ? 'plan-mode-active' : ''}`}
            onClick={() => onTaskModeChange(taskMode === 'plan' ? 'chat' : 'plan')}
            aria-pressed={taskMode === 'plan'}
            aria-label="切换计划模式"
          ><span className="plan-mode-mark">☷</span> 计划</button>
          <div className="composer-spacer" />
          <div className="strategy-toggle" role="group" aria-label="运行中发送策略">
            <button className={strategy === 'queue' ? 'strategy-active' : ''} onClick={() => onStrategyChange('queue')} aria-pressed={strategy === 'queue'}>排队</button>
            <button className={strategy === 'guide' ? 'strategy-active' : ''} onClick={() => onStrategyChange('guide')} aria-pressed={strategy === 'guide'}>引导</button>
          </div>
          <ModelSelector providers={providers} value={model} onChange={onModelChange} />
          <button className="icon-button muted" aria-label="语音输入"><Mic size={17} /></button>
          {isRunning ? (
            <button className="send-button stop-button" onClick={onStop} aria-label="停止任务"><Square size={15} fill="currentColor" /></button>
          ) : (
            <button className="send-button" onClick={submit} aria-label="发送消息" disabled={disabled || !model}><Send size={17} /></button>
          )}
        </div>
      </div>
      <div className="composer-caption"><Paperclip size={12} /> 首版仅分析项目并生成可审阅提议；不会写入文件或运行命令</div>
    </div>
  )
}
