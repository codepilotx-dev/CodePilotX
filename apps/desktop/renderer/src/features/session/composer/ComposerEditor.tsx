import {
  history,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from 'prosemirror-history'
import { baseKeymap, splitBlock } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { Schema } from 'prosemirror-model'
import { AllSelection, EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { useEditCommands } from '../../../components/ui/EditCommandProvider.js'

const composerSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: { inline: true },
  },
})

export type ComposerEditorHandle = {
  focus: () => void
}

export type ComposerEditorProps = {
  value: string
  placeholder: string
  ariaControls?: string
  ariaDescribedBy?: string
  ariaActiveDescendant?: string
  ariaExpanded: boolean
  onChange: (value: string) => void
  onSelectionChange: (offset: number) => void
  onCompositionChange: (composing: boolean) => void
  onKeyDown: (event: KeyboardEvent) => boolean
  onPasteFiles?: (files: FileList) => boolean
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor(
    {
      value,
      placeholder,
      ariaControls,
      ariaDescribedBy,
      ariaActiveDescendant,
      ariaExpanded,
      onChange,
      onSelectionChange,
      onCompositionChange,
      onKeyDown,
      onPasteFiles,
    },
    forwardedRef,
  ) {
    const { registerTarget } = useEditCommands()
    const mountRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)
    const callbacksRef = useRef({
      onChange,
      onSelectionChange,
      onCompositionChange,
      onKeyDown,
      onPasteFiles,
    })

    callbacksRef.current = {
      onChange,
      onSelectionChange,
      onCompositionChange,
      onKeyDown,
      onPasteFiles,
    }

    useImperativeHandle(forwardedRef, () => ({
      focus: () => viewRef.current?.focus(),
    }), [])

    useEffect(() => {
      const mount = mountRef.current
      if (!mount) return

      const state = EditorState.create({
        doc: documentFromText(value),
        plugins: [
          history(),
          keymap({
            'Shift-Enter': splitBlock,
            'Mod-z': undo,
            'Mod-Shift-z': redo,
            'Mod-y': redo,
          }),
          keymap(baseKeymap),
        ],
      })

      const view = new EditorView(mount, {
        state,
        attributes: {
          'aria-label': '消息输入框',
          role: 'textbox',
          'aria-multiline': 'true',
          spellcheck: 'true',
          class: 'composer-editor-content',
        },
        dispatchTransaction(transaction) {
          const nextState = view.state.apply(transaction)
          view.updateState(nextState)
          const documentChanged = transaction.steps.length > 0
          if (documentChanged) {
            callbacksRef.current.onChange(textFromDocument(nextState.doc))
          }
          if (transaction.selectionSet || documentChanged) {
            callbacksRef.current.onSelectionChange(
              textOffsetAtPosition(nextState, nextState.selection.from),
            )
          }
        },
        handleKeyDown: (_view, event) => callbacksRef.current.onKeyDown(event),
        handlePaste: (_view, event) => {
          const files = event.clipboardData?.files
          return files && files.length > 0
            ? (callbacksRef.current.onPasteFiles?.(files) ?? false)
            : false
        },
        handleDOMEvents: {
          compositionstart: () => {
            callbacksRef.current.onCompositionChange(true)
            return false
          },
          compositionend: () => {
            callbacksRef.current.onCompositionChange(false)
            queueMicrotask(() => {
              const current = viewRef.current
              if (current) {
                callbacksRef.current.onSelectionChange(
                  textOffsetAtPosition(
                    current.state,
                    current.state.selection.from,
                  ),
                )
              }
            })
            return false
          },
        },
      })

      viewRef.current = view
      const unregisterEditTarget = registerTarget(view.dom, {
        getCapabilities: () => {
          const selection = view.state.selection
          return {
            undo: undoDepth(view.state) > 0,
            redo: redoDepth(view.state) > 0,
            cut: !selection.empty,
            copy: !selection.empty,
            paste: true,
            delete: !selection.empty,
            selectAll:
              view.state.doc.content.size > 0 &&
              !(selection instanceof AllSelection),
          }
        },
        focus: () => view.focus(),
        perform: action => {
          if (action === 'undo') return undo(view.state, view.dispatch)
          if (action === 'redo') return redo(view.state, view.dispatch)
          if (action === 'delete') {
            if (view.state.selection.empty) return false
            view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
            return true
          }
          if (action === 'selectAll') {
            view.dispatch(
              view.state.tr
                .setSelection(new AllSelection(view.state.doc))
                .scrollIntoView(),
            )
            return true
          }
          return false
        },
      })
      return () => {
        unregisterEditTarget()
        viewRef.current = null
        view.destroy()
      }
      // The view owns its lifetime; callback changes flow through callbacksRef.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registerTarget])

    useEffect(() => {
      const view = viewRef.current
      if (!view || textFromDocument(view.state.doc) === value) return

      const previousOffset = textOffsetAtPosition(
        view.state,
        view.state.selection.from,
      )
      const nextDocument = documentFromText(value)
      const nextState = EditorState.create({
        doc: nextDocument,
        plugins: view.state.plugins,
        selection: TextSelection.create(
          nextDocument,
          positionAtTextOffset(nextDocument, previousOffset),
        ),
      })
      view.updateState(nextState)
    }, [value])

    useEffect(() => {
      const dom = viewRef.current?.dom
      if (!dom) return
      dom.setAttribute('data-placeholder', placeholder)
      dom.classList.toggle('is-empty', value.length === 0)
      dom.setAttribute('aria-expanded', String(ariaExpanded))
      dom.setAttribute('aria-haspopup', 'menu')
      setOptionalAttribute(dom, 'aria-controls', ariaControls)
      setOptionalAttribute(dom, 'aria-describedby', ariaDescribedBy)
      setOptionalAttribute(
        dom,
        'aria-activedescendant',
        ariaActiveDescendant,
      )
    }, [
      ariaActiveDescendant,
      ariaControls,
      ariaDescribedBy,
      ariaExpanded,
      placeholder,
      value,
    ])

    return <div className="composer-editor" ref={mountRef} />
  },
)

function documentFromText(value: string) {
  const paragraphs = value.split('\n').map((line) =>
    composerSchema.nodes.paragraph.create(
      null,
      line ? composerSchema.text(line) : undefined,
    ),
  )
  return composerSchema.nodes.doc.create(null, paragraphs)
}

function textFromDocument(doc: EditorState['doc']): string {
  return doc.textBetween(0, doc.content.size, '\n')
}

function textOffsetAtPosition(state: EditorState, position: number): number {
  return state.doc.textBetween(0, position, '\n').length
}

function positionAtTextOffset(doc: EditorState['doc'], offset: number): number {
  let remaining = Math.max(0, offset)
  let result = 1

  doc.forEach((paragraph, paragraphOffset) => {
    if (remaining < 0) return
    const length = paragraph.textContent.length
    if (remaining <= length) {
      result = paragraphOffset + 1 + remaining
      remaining = -1
      return
    }
    remaining -= length + 1
    result = paragraphOffset + paragraph.nodeSize - 1
  })

  return Math.min(result, doc.content.size)
}

function setOptionalAttribute(
  element: HTMLElement,
  name: string,
  value: string | undefined,
): void {
  if (value) element.setAttribute(name, value)
  else element.removeAttribute(name)
}
