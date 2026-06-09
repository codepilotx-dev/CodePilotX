import type React from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type {
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopPermissionRequest,
} from '../../shared/types.js'
import type { DrawerTab, ToolLogEntry } from '../uiTypes.js'

type Props = {
  isOpen: boolean
  activeTab: DrawerTab
  files: DesktopFileEntry[]
  selectedFile: DesktopFilePreview | null
  diff: string
  pendingPermissions: DesktopPermissionRequest[]
  toolLog: ToolLogEntry[]
  settingsContent: React.ReactNode
  onClose: () => void
  onSelectTab: (tab: DrawerTab) => void
  onPreviewFile: (file: DesktopFileEntry) => void
  onToggleToolLog: (entryId: string) => void
  onDecidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
  ) => void
}

const TABS: Array<{ value: DrawerTab; label: string }> = [
  { value: 'files', label: '文件' },
  { value: 'diff', label: '变更' },
  { value: 'permissions', label: '权限' },
  { value: 'toolLog', label: '工具日志' },
  { value: 'settings', label: '高级设置' },
]

export function RightDrawer({
  isOpen,
  activeTab,
  files,
  selectedFile,
  diff,
  pendingPermissions,
  toolLog,
  settingsContent,
  onClose,
  onSelectTab,
  onPreviewFile,
  onToggleToolLog,
  onDecidePermission,
}: Props): React.ReactNode {
  return (
    <aside className={isOpen ? 'right-drawer open' : 'right-drawer'}>
      <div className="right-drawer-header">
        <div className="right-drawer-tabs">
          {TABS.map(tab => (
            <button
              className={activeTab === tab.value ? 'drawer-tab active' : 'drawer-tab'}
              key={tab.value}
              onClick={() => onSelectTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="ghost-icon-button" onClick={onClose} title="关闭抽屉">
          <X size={16} />
        </button>
      </div>

      <div className="right-drawer-body">
        {activeTab === 'files' ? (
          <section className="drawer-section">
            <div className="drawer-file-list">
              {files.length === 0 ? (
                <p className="muted-copy">没有可预览的文件。</p>
              ) : (
                files.map(file => (
                  <button
                    className="drawer-file-row"
                    key={file.path}
                    onClick={() => onPreviewFile(file)}
                    style={{ paddingLeft: 12 + file.depth * 14 }}
                  >
                    <span>{file.type === 'directory' ? '目录' : '文件'}</span>
                    <strong>{file.name}</strong>
                  </button>
                ))
              )}
            </div>
            {selectedFile ? (
              <div className="drawer-preview">
                <strong>{selectedFile.path}</strong>
                {selectedFile.truncated ? <p className="muted-copy">预览已截断。</p> : null}
                <pre>{selectedFile.content}</pre>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'diff' ? (
          <section className="drawer-section">
            <pre className="diff-panel">{diff}</pre>
          </section>
        ) : null}

        {activeTab === 'permissions' ? (
          <section className="drawer-section">
            {pendingPermissions.length === 0 ? (
              <p className="muted-copy">当前没有待审批请求。</p>
            ) : (
              pendingPermissions.map(request => (
                <article className="permission-card" key={request.requestId}>
                  <strong>{request.toolName}</strong>
                  <p>{request.description}</p>
                  <code>{JSON.stringify(request.input)}</code>
                  <div>
                    <button onClick={() => onDecidePermission(request, 'allow')}>允许</button>
                    <button onClick={() => onDecidePermission(request, 'allow', true)}>
                      始终允许
                    </button>
                    <button onClick={() => onDecidePermission(request, 'deny')}>拒绝</button>
                  </div>
                </article>
              ))
            )}
          </section>
        ) : null}

        {activeTab === 'toolLog' ? (
          <section className="drawer-section">
            {toolLog.length === 0 ? (
              <p className="muted-copy">还没有工具活动记录。</p>
            ) : (
              toolLog.map(entry => (
                <article className={entry.isError ? 'tool-entry error' : 'tool-entry'} key={entry.id}>
                  <button onClick={() => onToggleToolLog(entry.id)}>
                    {entry.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{entry.toolName}</span>
                    <small>
                      {entry.kind} · {entry.createdAt}
                    </small>
                  </button>
                  {entry.expanded ? <p>{entry.summary}</p> : null}
                </article>
              ))
            )}
          </section>
        ) : null}

        {activeTab === 'settings' ? (
          <section className="drawer-section">{settingsContent}</section>
        ) : null}
      </div>
    </aside>
  )
}
