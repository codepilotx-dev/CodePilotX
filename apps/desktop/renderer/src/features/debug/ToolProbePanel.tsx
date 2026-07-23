import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Square, Copy, Check, AlertTriangle, Clock, Cpu, Folder, Terminal, Database, FileCode } from 'lucide-react'
import { desktopClient } from '../../services/desktop-client/index.js'
import type {
  DebugToolProbeMode,
  DebugToolProbeReport,
  RustSidecarProbeInfo,
} from '../../../shared/types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'

export function ToolProbePanel(): React.ReactNode {
  const [running, setRunning] = useState(false)
  const [lastReport, setLastReport] = useState<DebugToolProbeReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const cancelRef = useRef<string | null>(null)

  const startProbe = useCallback(async (): Promise<void> => {
    setError(null)
    setLastReport(null)
    setRunning(true)
    try {
      const report = await desktopClient.runDebugToolProbe('safe')
      cancelRef.current = report.runId
      setLastReport(report)
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') {
        setError('探针已被取消')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setRunning(false)
    }
  }, [])

  const cancelProbe = useCallback(async (): Promise<void> => {
    const runId = cancelRef.current
    if (!runId) return
    try {
      await desktopClient.cancelDebugToolProbe(runId)
      setRunning(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const copyReport = useCallback((): void => {
    if (!lastReport) return
    try {
      void navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may not be available
    }
  }, [lastReport])

  return (
    <section className="tool-probe-panel" aria-label="Rust Sidecar 探针">
      <div className="tool-probe-header">
        <h3>Rust Sidecar 探针</h3>
        <p className="tool-probe-summary">
          检测 Rust sidecar binary 状态、配置目录和协议能力
        </p>
      </div>

      <div className="tool-probe-actions">
        <button
          className="tool-probe-btn safe"
          disabled={running}
          type="button"
          onClick={startProbe}
        >
          <Play size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          {running ? '检测中...' : '检测 Rust Sidecar'}
        </button>
      </div>

      {running ? (
        <div className="tool-probe-running">
          <p>
            <Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            正在启动 Rust sidecar 并获取信息...
          </p>
          <button
            className="tool-probe-btn cancel"
            type="button"
            onClick={cancelProbe}
          >
            <Square size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            取消
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="tool-probe-error">
          <AlertTriangle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          {error}
        </div>
      ) : null}

      {lastReport ? (
        <div className="tool-probe-report">
          <div className="tool-probe-report-header">
            <h4>检测报告</h4>
            <button
              className="tool-probe-btn copy"
              type="button"
              onClick={copyReport}
            >
              {copied ? (
                <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              ) : (
                <Copy size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
              {copied ? '已复制' : '复制 JSON'}
            </button>
          </div>

          <div className="tool-probe-stats">
            <span className="stat passed">正常：{lastReport.passed}</span>
            <span className="stat failed">异常：{lastReport.failed}</span>
            <span className="stat skipped">跳过：{lastReport.skippedByEnvironment}</span>
          </div>

          <div className="tool-probe-items">
            {lastReport.items.map(item => (
              <RustProbeItemRow key={item.toolName} item={item} />
            ))}
          </div>
        </div>
      ) : (
        <div className="tool-probe-empty">
          <p>点击上方按钮检测 Rust sidecar 可用状态</p>
        </div>
      )}
    </section>
  )
}

function RustProbeItemRow({ item }: { item: DebugToolProbeReport['items'][number] }): React.ReactNode {
  const icon = (() => {
    switch (item.toolName) {
      case 'binary-path':
      case 'binary-source':
        return <Terminal size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      case 'binary-exists':
        return <Cpu size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      case 'config-directory':
        return <Folder size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      case 'sqlite-home':
        return <Database size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      case 'protocol-capabilities':
        return <FileCode size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      case 'user-agent':
        return <Terminal size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      default:
        return <Terminal size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
    }
  })()

  const statusLabel = (() => {
    switch (item.status) {
      case 'passed': return '正常'
      case 'failed': return '异常'
      case 'skippedByEnvironment': return '跳过'
      default: return item.status
    }
  })()

  const nameLabel = (() => {
    switch (item.toolName) {
      case 'binary-path': return 'Binary 路径'
      case 'binary-exists': return 'Binary 可用'
      case 'binary-source': return 'Binary 来源'
      case 'config-directory': return '配置目录'
      case 'sqlite-home': return 'SQLite 主目录'
      case 'protocol-capabilities': return '协议能力'
      case 'user-agent': return 'User Agent'
      default: return item.toolName
    }
  })()

  return (
    <div className={`tool-probe-item ${item.status}`}>
      <span className="item-icon">{icon}</span>
      <span className="item-name">{nameLabel}</span>
      <span className={`item-status ${item.status}`}>{statusLabel}</span>
      {item.reason ? <span className="item-reason">{item.reason}</span> : null}
      {item.error ? <span className="item-error">{item.error}</span> : null}
    </div>
  )
}
