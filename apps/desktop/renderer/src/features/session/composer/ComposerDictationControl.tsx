import type React from 'react'
import { Activity, Mic, Square } from 'lucide-react'
import { useEffect } from 'react'
import { IconButton } from '../../../components/ui/IconButton.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import type { ComposerEditorHandle } from './ComposerEditor.js'
import type { ComposerDraftKey } from './composerTypes.js'
import { useComposerDictation } from './useComposerDictation.js'

type Props = {
  draftKey: ComposerDraftKey
  editorRef: React.RefObject<ComposerEditorHandle | null>
  enabled: boolean
  registerToggle: (toggle: (() => void) | null) => void
}

export function ComposerDictationControl({
  draftKey,
  editorRef,
  enabled,
  registerToggle,
}: Props): React.ReactNode {
  const dictation = useComposerDictation({
    enabled,
    draftKey,
    onTranscript: text => editorRef.current?.insertText(text),
  })
  useEffect(() => {
    registerToggle(dictation.toggle)
    return () => registerToggle(null)
  }, [dictation.toggle, registerToggle])

  if (!dictation.status || dictation.status.state === 'unsupported') return null

  return (
    <>
      {dictation.phase !== 'idle' || dictation.error ? (
        <span
          className={`composer-dictation-status is-${dictation.phase}`}
          role={dictation.phase === 'error' ? 'alert' : 'status'}
        >
          <span aria-hidden="true" className="composer-dictation-dot" />
          <span>{dictationStatusText(dictation.phase, dictation.elapsedMs, dictation.error)}</span>
        </span>
      ) : null}
      <IconButton
        aria-label={dictation.phase === 'recording' ? '停止语音输入' : '语音输入'}
        aria-pressed={dictation.phase === 'recording'}
        className={`composer-mic-button${dictation.phase === 'recording' ? ' is-recording' : ''}`}
        disabled={!dictation.available}
        onClick={dictation.toggle}
        title={dictation.phase === 'recording' ? '停止语音输入 Ctrl+Shift+D' : dictation.status?.state === 'ready' ? '语音输入 Ctrl+Shift+D' : dictation.status?.error?.message ?? '语音模型正在准备中'}
      >
        {dictation.phase === 'recording' ? (
          <Square size={APP_ICON_SIZE} fill="currentColor" />
        ) : dictation.phase === 'processing' ? (
          <Activity aria-hidden="true" size={APP_ICON_SIZE} />
        ) : (
          <Mic size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        )}
      </IconButton>
    </>
  )
}

function dictationStatusText(
  phase: 'idle' | 'starting' | 'recording' | 'processing' | 'error',
  elapsedMs: number,
  message: string | null,
): string {
  if (message) return message
  if (phase === 'starting') return '正在连接麦克风…'
  if (phase === 'recording') {
    const seconds = Math.floor(elapsedMs / 1_000)
    return `听写 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }
  if (phase === 'processing') return '正在本地转写…'
  return '语音输入失败。'
}
