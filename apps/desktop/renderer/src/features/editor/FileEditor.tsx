import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'
import { useDesktopTheme } from '../theme/themeContext.js'
import {
  createCodeMirrorExtensions,
  createCodeMirrorSourceExtensions,
  loadCodeMirrorLanguage,
} from './codeMirrorSetup.js'
import { loadCodeMirrorTheme } from './codeMirrorTheme.js'
import { createMarkdownRichExtensions } from './markdownRichExtensions.js'

const CODE_FONT_FALLBACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export type FileEditorProps = {
  ariaLabel?: string
  className?: string
  error?: string | null
  language?: string
  onChange: (value: string) => void
  onSave?: () => void | Promise<void>
  path?: string
  presentation?: 'source' | 'markdown-rich'
  readonly?: boolean
  revealLine?: number | null
  saving?: boolean
  value: string
}

export function FileEditor({
  ariaLabel = '文件编辑器',
  className,
  error,
  language,
  onChange,
  onSave,
  path,
  presentation = 'source',
  readonly = false,
  revealLine,
  saving = false,
  value,
}: FileEditorProps): React.ReactNode {
  const { activeTheme, codeThemeId, draft, resolvedVariant } =
    useDesktopTheme()
  const configuredCodeFont = activeTheme.theme.fonts.code?.trim()
  const codeFontFamily = configuredCodeFont
    ? `${configuredCodeFont}, ${CODE_FONT_FALLBACK}`
    : CODE_FONT_FALLBACK
  const codeFontSize = draft.settings.fontSizes.code
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const applyingExternalValueRef = useRef(false)
  const readonlyCompartmentRef = useRef(new Compartment())
  const languageCompartmentRef = useRef(new Compartment())
  const presentationCompartmentRef = useRef(new Compartment())
  const themeCompartmentRef = useRef(new Compartment())
  const themeRequestRef = useRef(0)

  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const readonlyCompartment = readonlyCompartmentRef.current
    const languageCompartment = languageCompartmentRef.current
    const presentationCompartment = presentationCompartmentRef.current
    const themeCompartment = themeCompartmentRef.current
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...createCodeMirrorExtensions({
            onChange: nextValue => {
              if (!applyingExternalValueRef.current) {
                onChangeRef.current(nextValue)
              }
            },
            onSave: () => {
              void onSaveRef.current?.()
            },
          }),
          readonlyCompartment.of([
            EditorState.readOnly.of(readonly),
            EditorView.editable.of(!readonly),
          ]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          languageCompartment.of([]),
          presentationCompartment.of(
            createPresentationExtensions(presentation),
          ),
          themeCompartment.of([]),
        ],
      }),
    })
    viewRef.current = view

    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    const currentValue = view.state.doc.toString()
    if (currentValue === value) {
      return
    }
    applyingExternalValueRef.current = true
    try {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      })
    } finally {
      applyingExternalValueRef.current = false
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    view.dispatch({
      effects: readonlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readonly),
        EditorView.editable.of(!readonly),
      ]),
    })
  }, [readonly])

  useEffect(() => {
    const view = viewRef.current
    let active = true
    if (!view) {
      return
    }

    void loadCodeMirrorLanguage(path, language).then(extension => {
      if (!active || viewRef.current !== view) {
        return
      }
      view.dispatch({
        effects: languageCompartmentRef.current.reconfigure(extension),
      })
    })

    return () => {
      active = false
    }
  }, [language, path])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    view.dispatch({
      effects: presentationCompartmentRef.current.reconfigure(
        createPresentationExtensions(presentation),
      ),
    })
    view.requestMeasure()
  }, [presentation])

  useEffect(() => {
    const view = viewRef.current
    const request = ++themeRequestRef.current
    if (!view) {
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
          viewRef.current !== view
        ) {
          return
        }
        view.dispatch({
          effects: themeCompartmentRef.current.reconfigure(extension),
        })
        view.requestMeasure()
      })
      .catch(() => undefined)
  }, [
    codeFontFamily,
    codeFontSize,
    codeThemeId,
    resolvedVariant,
  ])

  useEffect(() => {
    const view = viewRef.current
    if (!view || revealLine == null) {
      return
    }
    const lineNumber = Math.max(
      1,
      Math.min(Math.trunc(revealLine), view.state.doc.lines),
    )
    const line = view.state.doc.line(lineNumber)
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
  }, [path, revealLine])

  return (
    <section
      className={cx('file-editor', className)}
      data-presentation={presentation}
      data-readonly={readonly || undefined}
    >
      <div
        ref={hostRef}
        className="file-editor-host"
      />
      {saving || error ? (
        <div
          className="file-editor-status"
          data-error={Boolean(error) || undefined}
          role={error ? 'alert' : 'status'}
        >
          {error ? `保存失败：${error}` : '正在保存…'}
        </div>
      ) : null}
    </section>
  )
}

function createPresentationExtensions(
  presentation: 'source' | 'markdown-rich',
) {
  return [
    EditorView.editorAttributes.of({
      'data-editor-presentation': presentation,
    }),
    presentation === 'markdown-rich'
      ? createMarkdownRichExtensions()
      : createCodeMirrorSourceExtensions(),
  ]
}
