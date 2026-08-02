import '../../styles/lazy/terminal.scss'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type {
  DesktopTerminalEvent,
  DesktopTerminalSnapshot,
} from '@codepilotx/shared/desktop-terminal-ipc'
import React, { use, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button.js'
import { loadDesktopTerminalClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import {
  consumeTerminalEvent,
  consumeTerminalSnapshot,
  createTerminalOutputState,
  type TerminalOutputState,
  type TerminalOutputUpdate,
} from './terminalOutputState.js'
import {
  OPEN_TERMINAL_EVENT,
  type OpenTerminalEventDetail,
} from './openTerminalEvent.js'
import { readTerminalFont, readTerminalTheme } from './terminalTheme.js'

export type TerminalPanelProps = {
  threadId: string
  onDisplayPathChange?: (displayPath: string | null) => void
}

const terminalClientPromise = loadDesktopTerminalClient()

export function TerminalPanel({ threadId, onDisplayPathChange }: TerminalPanelProps): React.ReactNode {
  const terminalClient = use(terminalClientPromise)
  const { draft } = useDesktopSettings()
  const profileId = draft.values.terminalProfileId
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const outputStateRef = useRef<TerminalOutputState>(createTerminalOutputState())
  const snapshotRef = useRef<DesktopTerminalSnapshot | null>(null)
  const displayPathCallbackRef = useRef(onDisplayPathChange)
  displayPathCallbackRef.current = onDisplayPathChange
  const replayPendingRef = useRef(false)
  const [status, setStatus] = useState<TerminalOutputState['state']>('starting')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restartVersion, setRestartVersion] = useState(0)

  const applyUpdate = useCallback((update: TerminalOutputUpdate): void => {
    outputStateRef.current = update.state
    setStatus(update.state.state)
    setExitCode(update.state.exitCode)
    const terminal = terminalRef.current
    if (!terminal) return
    if (update.reset) terminal.reset()
    for (const chunk of update.chunks) terminal.write(chunk.data)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const initialFont = readTerminalFont(document.documentElement)
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: !reducedMotion.matches,
      fontFamily: initialFont.fontFamily,
      fontSize: initialFont.fontSize,
      scrollback: 5_000,
      theme: readTerminalTheme(document.documentElement),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    let disposed = false
    displayPathCallbackRef.current?.(null)
    let snapshotReady = false
    let snapshotGeneration = 0
    const queuedEvents: DesktopTerminalEvent[] = []

    const adoptSnapshot = (snapshot: DesktopTerminalSnapshot): void => {
      snapshotGeneration += 1
      snapshotRef.current = snapshot
      displayPathCallbackRef.current?.(snapshotDisplayPath(snapshot))
      applyUpdate(consumeTerminalSnapshot(createTerminalOutputState(), snapshot))
      snapshotReady = true
      for (const event of queuedEvents.splice(0)) consumeEvent(event)
      setError(null)
    }

    const replay = async (): Promise<void> => {
      const current = outputStateRef.current
      if (
        replayPendingRef.current ||
        !current.terminalId ||
        !current.instanceId
      ) return
      replayPendingRef.current = true
      try {
        const snapshot = await terminalClient.attachTerminal({
          terminalId: current.terminalId,
          instanceId: current.instanceId,
          afterSequence: current.nextSequence - 1,
        })
        if (disposed) return
        snapshotRef.current = snapshot
        displayPathCallbackRef.current?.(snapshotDisplayPath(snapshot))
        const update = consumeTerminalSnapshot(outputStateRef.current, snapshot)
        applyUpdate(update)
        if (update.replayRequired) setError('终端输出存在缺口，请重新打开终端。')
      } catch (reason) {
        if (!disposed) setError(errorMessage(reason))
      } finally {
        replayPendingRef.current = false
      }
    }

    const consumeEvent = (event: DesktopTerminalEvent): void => {
      const update = consumeTerminalEvent(outputStateRef.current, event)
      applyUpdate(update)
      if (update.replayRequired) void replay()
    }

    const onOpenTerminal = (event: Event): void => {
      const detail = (event as CustomEvent<OpenTerminalEventDetail>).detail
      if (detail?.threadId !== threadId || !detail.snapshot) return
      adoptSnapshot(detail.snapshot)
    }
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpenTerminal)

    const unsubscribe = terminalClient.onTerminalEvent(event => {
      if (!snapshotReady) {
        queuedEvents.push(event)
        return
      }
      consumeEvent(event)
    })

    const inputDisposable = terminal.onData(data => {
      const snapshot = snapshotRef.current
      if (!snapshot || outputStateRef.current.state !== 'running') return
      terminalClient.writeTerminal({
        terminalId: snapshot.terminalId,
        instanceId: snapshot.instanceId,
        data,
      })
    })

    let resizeFrame: number | null = null
    let lastSize = { cols: 0, rows: 0 }
    const fitAndResize = (): void => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        if (disposed || host.clientWidth <= 0 || host.clientHeight <= 0) return
        fitAddon.fit()
        if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) return
        lastSize = { cols: terminal.cols, rows: terminal.rows }
        const snapshot = snapshotRef.current
        if (!snapshot || outputStateRef.current.state !== 'running') return
        terminalClient.resizeTerminal({
          terminalId: snapshot.terminalId,
          instanceId: snapshot.instanceId,
          cols: terminal.cols,
          rows: terminal.rows,
        })
      })
    }
    const resizeObserver = new ResizeObserver(fitAndResize)
    resizeObserver.observe(host)

    const themeObserver = new MutationObserver(() => {
      const font = readTerminalFont(document.documentElement)
      terminal.options.theme = readTerminalTheme(document.documentElement)
      terminal.options.fontFamily = font.fontFamily
      terminal.options.fontSize = font.fontSize
      fitAndResize()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })

    const initialize = async (): Promise<void> => {
      const initializeGeneration = snapshotGeneration
      try {
        fitAddon.fit()
        const snapshot = await terminalClient.ensureTerminal({
          threadId,
          profileId,
          cols: Math.max(2, terminal.cols),
          rows: Math.max(1, terminal.rows),
        })
        if (disposed || initializeGeneration !== snapshotGeneration) return
        snapshotRef.current = snapshot
        displayPathCallbackRef.current?.(snapshotDisplayPath(snapshot))
        const update = consumeTerminalSnapshot(createTerminalOutputState(), snapshot)
        applyUpdate(update)
        snapshotReady = true
        for (const event of queuedEvents.splice(0)) consumeEvent(event)
        fitAndResize()
        terminal.focus()
      } catch (reason) {
        snapshotReady = true
        if (!disposed) {
          setStatus('failed')
          setError(errorMessage(reason))
        }
      }
    }
    void initialize()

    return () => {
      disposed = true
      window.removeEventListener(OPEN_TERMINAL_EVENT, onOpenTerminal)
      unsubscribe()
      inputDisposable.dispose()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      snapshotRef.current = null
      outputStateRef.current = createTerminalOutputState()
      displayPathCallbackRef.current?.(null)
    }
  }, [applyUpdate, profileId, restartVersion, threadId])

  const handleRestart = useCallback(async (): Promise<void> => {
    const snapshot = snapshotRef.current
    setError(null)
    try {
      if (snapshot) {
        await terminalClient.closeTerminal({
          terminalId: snapshot.terminalId,
          instanceId: snapshot.instanceId,
          reason: 'user-close',
        })
      }
      setRestartVersion(version => version + 1)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [])

  return (
    <section
      className="integrated-terminal"
      data-terminal-keyboard-capture
      data-thread-id={threadId}
    >
      {status === 'exited' || status === 'failed' ? (
        <div className="integrated-terminal__lifecycle" role="status">
          <span>{error || terminalStatusLabel(status, exitCode)}</span>
          <Button type="button" onClick={() => void handleRestart()}>
            重新启动
          </Button>
        </div>
      ) : null}
      <div ref={hostRef} className="integrated-terminal__viewport" />
    </section>
  )
}

function terminalStatusLabel(
  status: TerminalOutputState['state'],
  exitCode: number | null,
): string {
  if (status === 'failed') return '启动失败'
  return exitCode === null ? '已退出' : `已退出（代码 ${exitCode}）`
}

function snapshotDisplayPath(snapshot: DesktopTerminalSnapshot): string | null {
  if (!('displayPath' in snapshot) || typeof snapshot.displayPath !== 'string') return null
  return snapshot.displayPath
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
