import { useEffect, useState } from 'react'
import type { BrowserAnnotation } from '@codepilotx/shared/browser-annotation'
import type { ComposerDraftKey } from '../session/composer/composerTypes.js'
import { composerDraftStore } from '../session/composer/composerDraftStore.js'
import { deleteBrowserAnnotation } from './browserAnnotationDraft.js'
import { Button } from '../../components/ui/Button.js'
import '../../styles/lazy/browser-annotations.scss'

export function BrowserAnnotationCard({
  annotation,
  source,
  onEdit,
  onDelete,
  editedBody,
  onDraftEdit,
}: {
  annotation: BrowserAnnotation
  source?: string
  onEdit?: (body: string) => void
  onDelete?: () => void
  editedBody?: string
  onDraftEdit?: (body: string | undefined) => void
}) {
  const [editing, setEditing] = useState(editedBody !== undefined),
    [body, setBody] = useState(editedBody ?? annotation.body)
  useEffect(() => {
    setBody(editedBody ?? annotation.body)
  }, [annotation.body, editedBody])
  return (
    <article className="browser-annotation-card">
      {source ? <img src={source} alt="批注截图" /> : null}
      <div>
        <strong>
          {annotation.anchors.map((anchor) => anchor.name || anchor.tagName || '区域').join(' · ')}
        </strong>
        {editing && onEdit ? (
          <div>
            <textarea
              aria-label="编辑批注反馈"
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                onDraftEdit?.(event.target.value)
              }}
            />
            <Button
              color="primary"
              disabled={!body.trim()}
              onClick={() => {
                onEdit(body.trim())
                setEditing(false)
              }}
            >
              保存反馈
            </Button>
            <Button
              color="secondary"
              onClick={() => {
                setBody(annotation.body)
                onDraftEdit?.(undefined)
                setEditing(false)
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <p>{annotation.body}</p>
        )}
        <details>
          <summary>定位和样式详情</summary>
          <pre>{JSON.stringify(annotation.anchors, null, 2)}</pre>
        </details>
        {onEdit && !editing ? (
          <Button
            color="secondary"
            onClick={() => {
              setEditing(true)
              onDraftEdit?.(annotation.body)
            }}
          >
            编辑反馈
          </Button>
        ) : null}
        {onDelete ? (
          <Button color="secondary" onClick={onDelete}>
            删除批注
          </Button>
        ) : null}
      </div>
    </article>
  )
}

export function BrowserAnnotationDraftCards({ draftKey }: { draftKey: ComposerDraftKey }) {
  const [, update] = useState(0)
  useEffect(() => composerDraftStore.subscribe(() => update((v) => v + 1)), [])
  const draft = composerDraftStore.get(draftKey)
  if (!draft.browserAnnotations?.length) return null
  return (
    <div className="browser-annotation-cards" aria-label="待发送的网页批注">
      {draft.browserAnnotations.map((annotation) => (
        <BrowserAnnotationCard
          key={annotation.id}
          annotation={annotation}
          editedBody={draft.browserAnnotationFeedback?.[annotation.id]}
          onDraftEdit={(body) =>
            composerDraftStore.updateBrowserAnnotations(draftKey, (current) => {
              const feedback = { ...current.browserAnnotationFeedback }
              if (body === undefined) delete feedback[annotation.id]
              else feedback[annotation.id] = body
              return { ...current, browserAnnotationFeedback: feedback }
            })
          }
          source={
            draft.browserAnnotationImages?.find((image) => image.name === annotation.screenshotName)
              ?.previewDataUrl
          }
          onEdit={(body) =>
            composerDraftStore.updateBrowserAnnotations(draftKey, (draft) => ({
              ...draft,
              browserAnnotationFeedback: Object.fromEntries(
                Object.entries(draft.browserAnnotationFeedback ?? {}).filter(
                  ([id]) => id !== annotation.id,
                ),
              ),
              browserAnnotations: draft.browserAnnotations?.map((a) =>
                a.id === annotation.id ? { ...a, body } : a,
              ),
            }))
          }
          onDelete={() =>
            composerDraftStore.updateBrowserAnnotations(draftKey, (draft) =>
              deleteBrowserAnnotation(draft, annotation.id),
            )
          }
        />
      ))}
    </div>
  )
}
