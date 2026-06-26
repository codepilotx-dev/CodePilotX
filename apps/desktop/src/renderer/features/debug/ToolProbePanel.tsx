import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Square, Copy, Check, X, AlertTriangle, HelpCircle, Clock } from 'lucide-react'
import { desktopClient } from '../../services/desktopClient.js'
import type {
  DebugToolProbeItem,
  DebugToolProbeMode,
  DebugToolProbeReport,
} from '../../../shared/types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'

export function ToolProbePanel(): React.ReactNode {
  const [toolNames, setToolNames] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [currentMode, setCurrentMode] = useState<DebugToolProbeMode | null>(null)
  const [lastReport, setLastReport] = useState<DebugToolProbeReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const cancelRef = useRef<string | null>(null)

  useEffect(() => {
    void desktopClient
      .listDebugBuiltinTools()
      .then(result => {
        setToolNames(result.toolNames)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  const startProbe = useCallback(async (mode: DebugToolProbeMode): Promise<void> => {
    setError(null)
    setLastReport(null)
    setRunning(true)
    setCurrentMode(mode)
    try {
      const report = await desktopClient.runDebugToolProbe(mode)
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
      setCurrentMode(null)
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

  const safeCount = toolNames.filter(n => {
    const stableSet = new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'PowerShell'])
    return stableSet.has(n)
  }).length

  const unsafeCount = toolNames.length - safeCount

  return (
    <section className="tool-probe-panel" aria-label="工具探针">
      <div className="tool-probe-header">
        <h3>工具探针</h3>
        <p className="tool-probe-summary">
          内置工具总数：{toolNames.length}，可探针工具：{safeCount}，不可探针：{unsafeCount}
        </p>
      </div>

      <div className="tool-probe-actions">
        <button
          className="tool-probe-btn safe"
          disabled={running}
          type="button"
          onClick={() => startProbe('safe')}
        >
          <Play size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          一键安全探针
        </button>
        <button
          className="tool-probe-btn manual"
          disabled={running}
          type="button"
          onClick={() => startProbe('realManual')}
        >
          <Play size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          真实调用（手动审批）
        </button>
        <button
          className="tool-probe-btn auto"
          disabled={running}
          type="button"
          onClick={() => startProbe('realAuto')}
        >
          <Play size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          真实调用（自动放行）
        </button>
      </div>

      {running ? (
        <div className="tool-probe-running">
          <p>
            <Clock size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            正在运行探针... 模式：{currentMode === 'safe' ? '安全' : currentMode === 'realManual' ? '手动审批' : currentMode === 'realAuto' ? '自动放行' : ''}
          </p>
          <button
            className="tool-probe-btn cancel"
            type="button"
            onClick={cancelProbe}
          >
            <Square size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            取消探针
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
            <h4>探针报告</h4>
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
            <span className="stat passed">通过：{lastReport.passed}</span>
            <span className="stat failed">失败：{lastReport.failed}</span>
            <span className="stat denied">权限拒绝：{lastReport.permissionDenied}</span>
            <span className="stat unsupported">不支持：{lastReport.unsupportedProbe}</span>
            <span className="stat skipped">环境跳过：{lastReport.skippedByEnvironment}</span>
          </div>

          <div className="tool-probe-items">
            {lastReport.items.map(item => (
              <ToolProbeItemRow key={item.toolName} item={item} />
            ))}
          </div>

          {lastReport.logPath ? (
            <p className="tool-probe-log-path">日志路径：{lastReport.logPath}</p>
          ) : null}
        </div>
      ) : (
        <div className="tool-probe-empty">
          <p>点击上方按钮开始工具探针测试</p>
        </div>
      )}
    </section>
  )
}

function ToolProbeItemRow({ item }: { item: DebugToolProbeItem }): React.ReactNode {
  const statusIcon = (() => {
    switch (item.status) {
      case 'passed':
        return <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} className="icon-passed" />
      case 'failed':
        return <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} className="icon-failed" />
      case 'permissionDenied':
        return <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} className="icon-denied" />
      case 'unsupportedProbe':
        return <HelpCircle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} className="icon-unsupported" />
      case 'skippedByEnvironment':
        return <AlertTriangle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} className="icon-skipped" />
    }
  })()

  return (
    <div className={`tool-probe-item ${item.status}`}>
      <span className="item-icon">{statusIcon}</span>
      <span className="item-name">{item.toolName}</span>
      <span className="item-status">{item.status}</span>
      {item.reason ? <span className="item-reason">{item.reason}</span> : null}
      {item.durationMs !== undefined ? (
        <span className="item-duration">{item.durationMs}ms</span>
      ) : null}
      {item.error ? <span className="item-error">{item.error}</span> : null}
    </div>
  )
}
