import { useEffect, useId, useRef, useState } from 'react'
import type React from 'react'
import type { DesktopPermissionRequest } from '../../shared/types.js'

type KeyboardChoice = 1 | 2 | 3 | null

export type PermissionDecisionOptions = {
  alwaysAllow?: boolean
  feedback?: string
}

export type PermissionDialogProps = {
  request: DesktopPermissionRequest
  onDecide: (
    behavior: 'allow' | 'deny',
    options?: PermissionDecisionOptions,
  ) => void
}

const RISK_LABELS = {
  safe: {
    title: '权限请求',
    subtitle: 'Codex 想要执行以下工具调用，请确认。',
  },
  compound: {
    title: '复合命令安全拦截',
    subtitle:
      '默认权限下，Codex 想用 `&&`、`;`、管道等把多个命令拼在一起执行。',
  },
  destructive: {
    title: '高风险命令拦截',
    subtitle: '默认权限下，Codex 试图执行可能造成不可逆影响的命令。',
  },
} as const

function mapKeyToChoice(key: string): KeyboardChoice {
  if (key === '1') return 1
  if (key === '2') return 2
  if (key === '3') return 3
  return null
}

export function PermissionDialog({
  request,
  onDecide,
}: PermissionDialogProps): React.ReactNode {
  const [activeOption, setActiveOption] = useState<1 | 2 | 3>(1)
  const [feedback, setFeedback] = useState('')
  const [feedbackExpanded, setFeedbackExpanded] = useState(false)
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null)
  const textareaId = useId()

  const risk = request.risk ?? 'safe'
  const labels = RISK_LABELS[risk]
  const commandPreview = request.commandPreview ?? ''
  const commandPrefix = request.commandPrefix ?? ''
  const supportsPrefixOption =
    risk === 'compound' && commandPrefix.trim().length > 0

  useEffect(() => {
    setActiveOption(1)
    setFeedback('')
    setFeedbackExpanded(false)
  }, [request.requestId])

  useEffect(() => {
    if (activeOption === 3 && feedbackExpanded) {
      feedbackRef.current?.focus()
    }
  }, [activeOption, feedbackExpanded])

  useEffect(() => {
    if (!request) return
    const handleKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
          return
        }
      }
      const choice = mapKeyToChoice(event.key)
      if (choice !== null) {
        event.preventDefault()
        if (choice === 1) {
          onDecide('allow', { alwaysAllow: false })
          return
        }
        if (choice === 2) {
          onDecide('allow', { alwaysAllow: true })
          return
        }
        setActiveOption(3)
        setFeedbackExpanded(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [onDecide, request])

  const handleSubmit = (): void => {
    if (activeOption === 1) {
      onDecide('allow', { alwaysAllow: false })
      return
    }
    if (activeOption === 2) {
      if (supportsPrefixOption) {
        onDecide('allow', { alwaysAllow: true })
      } else {
        onDecide('allow', { alwaysAllow: true })
      }
      return
    }
    const trimmed = feedback.trim()
    onDecide('deny', trimmed ? { feedback: trimmed } : {})
  }

  const handleSkipFeedback = (): void => {
    onDecide('deny')
  }

  return (
    <div className="permission-modal" role="dialog" aria-modal="true">
      <header className="permission-modal-header">
        <div className="permission-modal-title">
          <h2>{labels.title}</h2>
          <span className="permission-modal-tool">{request.toolName}</span>
        </div>
        <p className="permission-modal-subtitle">{labels.subtitle}</p>
      </header>

      {commandPreview ? (
        <pre className="permission-modal-command" aria-label="待执行命令">
          {commandPreview}
        </pre>
      ) : (
        <code className="permission-modal-input">
          {JSON.stringify(request.input, null, 2)}
        </code>
      )}

      <p className="permission-modal-description">{request.description}</p>

      <ol className="permission-modal-options">
        <li
          className={activeOption === 1 ? 'is-active' : undefined}
          onMouseEnter={() => setActiveOption(1)}
          onClick={() => {
            setActiveOption(1)
            onDecide('allow', { alwaysAllow: false })
          }}
        >
          <span className="permission-modal-options-index">1.</span>
          <span className="permission-modal-options-label">是</span>
          <span className="permission-modal-options-hint">
            仅本次会话允许执行。
          </span>
        </li>
        {supportsPrefixOption ? (
          <li
            className={activeOption === 2 ? 'is-active' : undefined}
            onMouseEnter={() => setActiveOption(2)}
            onClick={() => {
              setActiveOption(2)
              onDecide('allow', { alwaysAllow: true })
            }}
          >
            <span className="permission-modal-options-index">2.</span>
            <span className="permission-modal-options-label">
              是，且对于以后以
              <code className="permission-modal-options-prefix">
                {commandPrefix}
              </code>
              开头的命令不再询问
            </span>
            <span className="permission-modal-options-hint">
              之后看到同前缀命令会直接放行。
            </span>
          </li>
        ) : (
          <li
            className={activeOption === 2 ? 'is-active' : undefined}
            onMouseEnter={() => setActiveOption(2)}
            onClick={() => {
              setActiveOption(2)
              onDecide('allow', { alwaysAllow: true })
            }}
          >
            <span className="permission-modal-options-index">2.</span>
            <span className="permission-modal-options-label">
              是，且今后不再询问同类请求
            </span>
            <span className="permission-modal-options-hint">
              同一工具调用将默认放行。
            </span>
          </li>
        )}
        <li
          className={activeOption === 3 ? 'is-active' : undefined}
          onMouseEnter={() => setActiveOption(3)}
          onClick={() => {
            setActiveOption(3)
            setFeedbackExpanded(true)
          }}
        >
          <span className="permission-modal-options-index">3.</span>
          <span className="permission-modal-options-label">
            否，请告知 Codex 如何调整
          </span>
          <span className="permission-modal-options-hint">
            拒绝并把改写建议回传给模型。
          </span>
        </li>
      </ol>

      {activeOption === 3 && feedbackExpanded ? (
        <div className="permission-modal-feedback">
          <label htmlFor={textareaId} className="permission-modal-feedback-label">
            告诉 Codex 该怎么调整命令：
          </label>
          <textarea
            id={textareaId}
            ref={feedbackRef}
            className="permission-modal-feedback-input"
            rows={3}
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
            placeholder="例如：不要用 `cd ... && git ...`，请把命令拆成两步执行。"
          />
          <div className="permission-modal-feedback-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={handleSkipFeedback}
            >
              跳过
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleSubmit}
            >
              提交
            </button>
          </div>
        </div>
      ) : (
        <div className="permission-modal-actions">
          <span className="permission-modal-hint">
            按 1/2/3 选择，回车确认。
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={handleSubmit}
          >
            确认（{activeOption === 1 ? '是' : activeOption === 2 ? '始终是' : '否'}）
          </button>
        </div>
      )}
    </div>
  )
}
