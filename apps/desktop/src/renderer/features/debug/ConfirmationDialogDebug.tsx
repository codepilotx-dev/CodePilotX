import type React from 'react'
import { useState } from 'react'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

type VariantKey =
  | 'removeProject'
  | 'archiveMany'
  | 'renameProject'
  | 'renameSession'

type Variant = {
  key: VariantKey
  label: string
  description: string
  open: () => void
}

const RENAMED_PROJECT_VALUE = 'Test'
const RENAMED_SESSION_VALUE = '优化Apple风格界面'

export function ConfirmationDialogDebug(): React.ReactNode {
  const [active, setActive] = useState<VariantKey | null>(null)
  const [projectName, setProjectName] = useState(RENAMED_PROJECT_VALUE)
  const [sessionName, setSessionName] = useState(RENAMED_SESSION_VALUE)
  const [lastAction, setLastAction] = useState<string | null>(null)

  const variants: Variant[] = [
    {
      key: 'removeProject',
      label: '移除项目（danger / 无输入）',
      description: '确认是否要移除一个项目，对应截图 1。',
      open: () => setActive('removeProject'),
    },
    {
      key: 'archiveMany',
      label: '归档 N 个对话（danger / 无输入）',
      description: '确认是否要一次性归档多个会话，对应截图 2。',
      open: () => setActive('archiveMany'),
    },
    {
      key: 'renameProject',
      label: '重命名项目（primary / 有输入）',
      description: '表单态：标题 + 描述 + 输入框，对应截图 3。',
      open: () => setActive('renameProject'),
    },
    {
      key: 'renameSession',
      label: '重命名对话（primary / 有输入）',
      description: '表单态：标题 + 描述 + 输入框，对应截图 4。',
      open: () => setActive('renameSession'),
    },
  ]

  function close(): void {
    setActive(null)
  }

  function logAction(label: string): void {
    setLastAction(`${new Date().toLocaleTimeString()} · ${label}`)
  }

  return (
    <section className="dialog-debug-panel" aria-label="对话框调试">
      <div className="dialog-debug-panel-content">
        <div className="dialog-debug-header">
          <h3>ConfirmationDialog 调试</h3>
          <p className="dialog-debug-summary">
            点击下方按钮即可在右侧唤起对应弹窗，便于检查四种状态的样式与交互。
          </p>
        </div>

        <div className="dialog-debug-list">
          {variants.map(variant => (
            <button
              className="dialog-debug-item"
              key={variant.key}
              onClick={variant.open}
              type="button"
            >
              <span className="dialog-debug-item-label">{variant.label}</span>
              <span className="dialog-debug-item-desc">{variant.description}</span>
            </button>
          ))}
        </div>

        {lastAction ? (
          <div className="dialog-debug-log">
            <span className="dialog-debug-log-label">最近一次触发：</span>
            <span className="dialog-debug-log-value">{lastAction}</span>
          </div>
        ) : null}
      </div>

      <ConfirmationDialog
        actionLabel="移除"
        description="这将从 Codex 中移除该项目。磁盘上的文件不会被删除。"
        open={active === 'removeProject'}
        title="移除 Test?"
        tone="danger"
        onAction={() => {
          logAction('移除项目 → onAction')
          close()
        }}
        onCancel={() => {
          logAction('移除项目 → onCancel')
          close()
        }}
      />

      <ConfirmationDialog
        actionLabel="全部归档"
        description="这会将 Test 中的对话归档。之后你可以在已归档对话中找到它们。"
        open={active === 'archiveMany'}
        title="归档 2 个对话?"
        tone="danger"
        onAction={() => {
          logAction('归档 2 个对话 → onAction')
          close()
        }}
        onCancel={() => {
          logAction('归档 2 个对话 → onCancel')
          close()
        }}
      />

      <ConfirmationDialog
        actionLabel="保存"
        description="保持简短且易于识别"
        input={{
          value: projectName,
          onChange: setProjectName,
          maxLength: 80,
          placeholder: '项目名称',
        }}
        open={active === 'renameProject'}
        title="重命名项目"
        tone="primary"
        onAction={() => {
          logAction(`重命名项目 → onAction（${projectName}）`)
          close()
        }}
        onCancel={() => {
          setProjectName(RENAMED_PROJECT_VALUE)
          logAction('重命名项目 → onCancel')
          close()
        }}
      />

      <ConfirmationDialog
        actionLabel="保存"
        description="保持简短且易于识别"
        input={{
          value: sessionName,
          onChange: setSessionName,
          maxLength: 80,
          placeholder: '对话标题',
        }}
        open={active === 'renameSession'}
        title="重命名对话"
        tone="primary"
        onAction={() => {
          logAction(`重命名对话 → onAction（${sessionName}）`)
          close()
        }}
        onCancel={() => {
          setSessionName(RENAMED_SESSION_VALUE)
          logAction('重命名对话 → onCancel')
          close()
        }}
      />
    </section>
  )
}
