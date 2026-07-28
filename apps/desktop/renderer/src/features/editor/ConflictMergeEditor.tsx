import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { useEffect, useRef } from 'react'
import type React from 'react'
import { Button } from '../../components/ui/Button.js'
import { cx } from '../../utils/cx.js'
import { useDesktopTheme } from '../theme/themeContext.js'
import {
  createCodeMirrorExtensions,
  createCodeMirrorSourceExtensions,
  loadCodeMirrorLanguage,
} from './codeMirrorSetup.js'
import { loadCodeMirrorTheme } from './codeMirrorTheme.js'

const CODE_FONT_FALLBACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

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
  const { activeTheme, codeThemeId, draft, resolvedVariant } =
    useDesktopTheme()
  const configuredCodeFont = activeTheme.theme.fonts.code?.trim()
  const codeFontFamily = configuredCodeFont
    ? `${configuredCodeFont}, ${CODE_FONT_FALLBACK}`
    : CODE_FONT_FALLBACK
  const codeFontSize = draft.settings.fontSizes.code
  const hostRef = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)
  const onChangeRef = useRef(onChangeLocal)
  const onSaveRef = useRef(onKeepLocal)
  const applyingExternalLocalValueRef = useRef(false)
  const diskLanguageCompartmentRef = useRef(new Compartment())
  const localLanguageCompartmentRef = useRef(new Compartment())
  const diskThemeCompartmentRef = useRef(new Compartment())
  const localThemeCompartmentRef = useRef(new Compartment())
  const themeRequestRef = useRef(0)

  onChangeRef.current = onChangeLocal
  onSaveRef.current = onKeepLocal

  useEffect(() => {
    if (!hostRef.current) {
      return
    }
    const merge = new MergeView({
      parent: hostRef.current,
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true,
      a: {
        doc: diskValue,
        extensions: [
          ...createCodeMirrorExtensions({}),
          ...createCodeMirrorSourceExtensions(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          diskLanguageCompartmentRef.current.of([]),
          diskThemeCompartmentRef.current.of([]),
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
          ...createCodeMirrorSourceExtensions(),
          localLanguageCompartmentRef.current.of([]),
          localThemeCompartmentRef.current.of([]),
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
      merge.b.dispatch({
        effects:
          localLanguageCompartmentRef.current.reconfigure(extension),
      })
      merge.a.dispatch({
        effects:
          diskLanguageCompartmentRef.current.reconfigure(extension),
      })
    })

    return () => {
      active = false
    }
  }, [language, path])

  useEffect(() => {
    const merge = mergeRef.current
    const request = ++themeRequestRef.current
    if (!merge) {
      return
    }

    void loadCodeMirrorTheme({
      codeThemeId,
      fontFamily: codeFontFamily,
      fontSize: codeFontSize,
      variant: resolvedVariant,
    })
      .then(extension => {
        if (
          request !== themeRequestRef.current ||
          mergeRef.current !== merge
        ) {
          return
        }
        merge.a.dispatch({
          effects:
            diskThemeCompartmentRef.current.reconfigure(extension),
        })
        merge.b.dispatch({
          effects:
            localThemeCompartmentRef.current.reconfigure(extension),
        })
        merge.a.requestMeasure()
        merge.b.requestMeasure()
      })
      .catch(() => undefined)
  }, [
    codeFontFamily,
    codeFontSize,
    codeThemeId,
    resolvedVariant,
  ])

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
          >
            使用磁盘版本
          </Button>
          <Button
            loading={saving}
            onClick={() => void onKeepLocal()}
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
