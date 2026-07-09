import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Save, Trash2 } from 'lucide-react'
import { desktopClient } from '../../services/desktopClient.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import type {
  DesktopMemoryRecallEvent,
  DesktopProjectMemory,
  DesktopProjectMemoryContent,
} from '../../../shared/types.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { useDesktopSettings } from './useDesktopSettings.js'

const MEMORY_TYPES = ['all', 'user', 'feedback', 'project', 'reference'] as const

type MemoryTypeFilter = (typeof MEMORY_TYPES)[number]

export function MemorySettings(): React.ReactNode {
  const { draft } = useDesktopSettings()
  const [workspacePath, setWorkspacePath] = useState(
    draft.values.recentWorkspaces[0]?.path ?? '',
  )
  const [memories, setMemories] = useState<DesktopProjectMemory[]>([])
  const [memoryDir, setMemoryDir] = useState('')
  const [recalls, setRecalls] = useState<DesktopMemoryRecallEvent[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedMemory, setSelectedMemory] =
    useState<DesktopProjectMemoryContent | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<MemoryTypeFilter>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredMemories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return memories.filter(memory => {
      if (typeFilter !== 'all' && memory.type !== typeFilter) return false
      if (!normalizedQuery) return true
      return (
        memory.relativePath.toLowerCase().includes(normalizedQuery) ||
        (memory.description ?? '').toLowerCase().includes(normalizedQuery)
      )
    })
  }, [memories, query, typeFilter])

  const refresh = async (): Promise<void> => {
    if (!workspacePath.trim()) return
    setBusy(true)
    setError(null)
    try {
      const [listing, recallListing] = await Promise.all([
        desktopClient.listProjectMemories(workspacePath.trim()),
        desktopClient.listProjectMemoryRecalls(workspacePath.trim()),
      ])
      setMemories(listing.memories)
      setMemoryDir(listing.memoryDir)
      setRecalls(recallListing.recalls)
      if (selectedPath) {
        const stillExists = listing.memories.some(
          memory => memory.relativePath === selectedPath,
        )
        if (!stillExists) {
          setSelectedPath(null)
          setSelectedMemory(null)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // Refresh is intentionally not a dependency; it closes over UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  const openMemory = async (relativePath: string): Promise<void> => {
    if (!workspacePath.trim()) return
    setSelectedPath(relativePath)
    setBusy(true)
    setError(null)
    try {
      setSelectedMemory(
        await desktopClient.readProjectMemory(workspacePath.trim(), relativePath),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveSelected = async (): Promise<void> => {
    if (!workspacePath.trim() || !selectedMemory) return
    setBusy(true)
    setError(null)
    try {
      const saved = await desktopClient.saveProjectMemory({
        workspacePath: workspacePath.trim(),
        relativePath: selectedMemory.relativePath,
        content: selectedMemory.content,
      })
      setMemories(current =>
        current.map(memory =>
          memory.relativePath === saved.relativePath ? saved : memory,
        ),
      )
      setSelectedMemory({ ...saved, content: selectedMemory.content })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const deleteSelected = async (): Promise<void> => {
    if (!workspacePath.trim() || !selectedMemory) return
    const confirmed = window.confirm(`删除记忆 ${selectedMemory.relativePath}？`)
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await desktopClient.deleteProjectMemory({
        workspacePath: workspacePath.trim(),
        relativePath: selectedMemory.relativePath,
      })
      setSelectedPath(null)
      setSelectedMemory(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const resetMemories = async (includeRecallLog: boolean): Promise<void> => {
    if (!workspacePath.trim()) return
    const confirmed = window.confirm(
      includeRecallLog
        ? '删除此工作区所有自动记忆和召回时间线？'
        : '删除此工作区所有自动记忆，但保留召回时间线？',
    )
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await desktopClient.resetProjectMemory({
        workspacePath: workspacePath.trim(),
        includeRecallLog,
      })
      setSelectedPath(null)
      setSelectedMemory(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsContentArea className="memory-settings-page">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">记忆</h2>
          <p className="settings-page-desc">
            管理当前工作区的自动长期记忆和召回时间线。
          </p>
        </div>

        <SettingsSection title="记忆状态">
          <SettingsRow
            title="启用记忆"
            description="新会话会读取和写入此工作区的自动记忆"
            autoSave
            control={
              <ToggleSwitch
                ariaLabel="启用记忆"
                checked={draft.values.enableMemory}
                onChange={value => {
                  draft.setValue('enableMemory', value)
                  draft.autoSave()
                }}
              />
            }
          />
          <SettingsRow
            title="工作区"
            description={memoryDir || '选择或输入工作区路径后加载记忆'}
            control={
              <input
                className="settings-input"
                value={workspacePath}
                onChange={event => setWorkspacePath(event.target.value)}
                placeholder="D:\\path\\to\\workspace"
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="项目记忆"
          actions={
            <div className="settings-inline-actions">
              <button
                className="settings-button"
                disabled={busy || !workspacePath.trim()}
                onClick={() => void refresh()}
                type="button"
              >
                <RefreshCw size={APP_ICON_SIZE} />
                刷新
              </button>
              <button
                className="settings-button"
                disabled={busy || !workspacePath.trim()}
                onClick={() => void resetMemories(false)}
                type="button"
              >
                重置记忆
              </button>
              <button
                className="settings-button"
                disabled={busy || !workspacePath.trim()}
                onClick={() => void resetMemories(true)}
                type="button"
              >
                全部重置
              </button>
            </div>
          }
        >
          <div className="memory-settings-toolbar">
            <input
              className="settings-input memory-settings-search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索文件名或描述"
            />
            <select
              className="settings-input memory-settings-filter"
              value={typeFilter}
              onChange={event =>
                setTypeFilter(event.target.value as MemoryTypeFilter)
              }
            >
              {MEMORY_TYPES.map(type => (
                <option key={type} value={type}>
                  {type === 'all' ? '全部类型' : type}
                </option>
              ))}
            </select>
            <span className="memory-settings-count">
              {filteredMemories.length} 条
            </span>
          </div>
          {error ? <p className="settings-row-error">{error}</p> : null}
          <div className="memory-settings-grid">
            <div className="memory-settings-panel">
              <div className="memory-settings-panel-header">
                <span>记忆列表</span>
              </div>
              <div className="memory-settings-list-scroll-area">
                <div className="memory-settings-list-scroll-content">
                  {filteredMemories.map(memory => (
                    <button
                      key={memory.relativePath}
                      className={
                        selectedPath === memory.relativePath
                          ? 'memory-settings-item active'
                          : 'memory-settings-item'
                      }
                      onClick={() => void openMemory(memory.relativePath)}
                      type="button"
                    >
                      <span className="memory-settings-item-name">
                        {memory.relativePath}
                      </span>
                      <span className="memory-settings-item-meta">
                        <span className="memory-settings-item-type">
                          {memory.type ?? 'unknown'}
                        </span>
                        <span className="memory-settings-item-desc">
                          {memory.description ?? '无描述'}
                        </span>
                      </span>
                    </button>
                  ))}
                  {filteredMemories.length === 0 ? (
                    <div className="settings-empty-state">暂无记忆</div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="memory-settings-panel">
              <div className="memory-settings-panel-header memory-settings-panel-header-editor">
                <span className="memory-settings-editor-title">
                  {selectedMemory
                    ? selectedMemory.relativePath
                    : '内容编辑'}
                </span>
                {selectedMemory ? (
                  <div className="memory-settings-editor-actions">
                    <button
                      className="settings-button"
                      disabled={busy}
                      onClick={() => void saveSelected()}
                      type="button"
                    >
                      <Save size={APP_ICON_SIZE} />
                      保存
                    </button>
                    <button
                      className="settings-button danger"
                      disabled={busy}
                      onClick={() => void deleteSelected()}
                      type="button"
                    >
                      <Trash2 size={APP_ICON_SIZE} />
                      删除
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="memory-settings-editor-scroll-area">
                <div className="memory-settings-editor-scroll-content">
                  {selectedMemory ? (
                    <textarea
                      className="settings-textarea memory-settings-editor-textarea"
                      value={selectedMemory.content}
                      onChange={event =>
                        setSelectedMemory({
                          ...selectedMemory,
                          content: event.target.value,
                        })
                      }
                    />
                  ) : (
                    <div className="settings-empty-state">
                      选择一条记忆查看内容
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title="召回时间线">
          <div className="memory-recall-list-scroll-area">
            <div className="memory-recall-list-scroll-content">
              {recalls.map((recall, index) => (
                <article className="memory-recall-item" key={`${recall.createdAt}-${index}`}>
                  <span className="memory-recall-time">
                    {new Date(recall.createdAt).toLocaleString()}
                  </span>
                  <span className="memory-recall-summary">
                    {recall.querySummary}
                  </span>
                  <span className="memory-recall-files">
                    {recall.memories
                      .map(memory =>
                        `${memory.relativePath}${memory.truncated ? ' (截断)' : ''}`,
                      )
                      .join(', ')}
                  </span>
                </article>
              ))}
              {recalls.length === 0 ? (
                <div className="settings-empty-state">暂无召回记录</div>
              ) : null}
            </div>
          </div>
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}
