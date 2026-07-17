import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { useEffect, useRef } from 'react'
import type React from 'react'
import { Button } from '../../components/ui/Button.js'
import { cx } from '../../utils/cx.js'
import {
  createCodeMirrorExtensions,
  loadCodeMirrorLanguage,
} from './codeMirrorSetup.js'

export type ConflictMergeEditorProps = {
  className?: string
  diskValue: string
  error?: string | null
  language?: string
  localValue: string
  onChangeLocal: (value: string) => void
  onKeepLocal: () => void | Promise<void>
  onUseDisk: () => void
  path?: string
  saving?: boolean
}

export function ConflictMergeEditor({
  className,
  diskValue,
  error,
  language,
  localValue,
  onChangeLocal,
  onKeepLocal,
  onUseDisk,
  path,
  saving = false,
}: ConflictMergeEditorProps): React.ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)
  const onChangeRef = useRef(onChangeLocal)
  const onSaveRef = useRef(onKeepLocal)
  const applyingExternalLocalValueRef = useRef(false)
  const languageCompartmentRef = useRef(new Compartment())

  onChangeRef.current = onChangeLocal
  onSaveRef.current = onKeepLocal

  useEffect(() => {
    if (!hostRef.current) {
      return
    }
    const languageCompartment = languageCompartmentRef.current
    const merge = new MergeView({
      parent: hostRef.current,
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true,
      a: {
        doc: diskValue,
        extensions: [
          ...createCodeMirrorExtensions({}),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          languageCompartment.of([]),
        ],
      },
      b: {
        doc: localValue,
        extensions: [
          ...createCodeMirrorExtensions({
            onChange: nextValue => {
              if (!applyingExternalLocalValueRef.current) {
                onChangeRef.current(nextValue)
              }
            },
            onSave: () => {
              void onSaveRef.current()
            },
          }),
          languageCompartment.of([]),
        ],
      },
    })
    mergeRef.current = merge

    return () => {
      mergeRef.current = null
      merge.destroy()
    }
  }, [])

  useEffect(() => {
    const merge = mergeRef.current
    if (!merge) {
      return
    }
    replaceDocument(merge.a, diskValue)
  }, [diskValue])

  useEffect(() => {
    const merge = mergeRef.current
    if (!merge) {
      return
    }
    applyingExternalLocalValueRef.current = true
    try {
      replaceDocument(merge.b, localValue)
    } finally {
      applyingExternalLocalValueRef.current = false
    }
  }, [localValue])

  useEffect(() => {
    const merge = mergeRef.current
    let active = true
    if (!merge) {
      return
    }

    void loadCodeMirrorLanguage(path, language).then(extension => {
      if (!active || mergeRef.current !== merge) {
        return
      }
      const effect = languageCompartmentRef.current.reconfigure(extension)
      merge.a.dispatch({ effects: effect })
      merge.b.dispatch({
        effects: languageCompartmentRef.current.reconfigure(extension),
      })
    })

    return () => {
      active = false
    }
  }, [language, path])

  return (
    <section className={cx('conflict-merge-editor', className)}>
      <header className="conflict-merge-editor-header">
        <div>
          <strong>文件已在外部更改</strong>
          <span>左侧为磁盘版本，右侧为本地草稿。</span>
        </div>
        <div className="conflict-merge-editor-actions">
          <Button
            disabled={saving}
            onClick={onUseDisk}
            size="sm"
            variant="secondary"
          >
            使用磁盘版本
          </Button>
          <Button
            loading={saving}
            onClick={() => void onKeepLocal()}
            size="sm"
            variant="primary"
          >
            保留本地版本
          </Button>
        </div>
      </header>
      <div className="conflict-merge-editor-labels" aria-hidden="true">
        <span>磁盘版本</span>
        <span>本地草稿 / 合并结果</span>
      </div>
      <div ref={hostRef} className="conflict-merge-editor-host" />
      {error ? (
        <div className="file-editor-status" data-error role="alert">
          保存失败：{error}
        </div>
      ) : null}
    </section>
  )
}

function replaceDocument(view: EditorView, value: string): void {
  const currentValue = view.state.doc.toString()
  if (currentValue === value) {
    return
  }
  view.dispatch({
    changes: { from: 0, to: currentValue.length, insert: value },
  })
}
