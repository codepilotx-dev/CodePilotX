import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { UserAttachmentPreviewTab } from '../../layout/dock/rightDockState.js'

export type LoadedUserAttachment = {
  attachment: UserAttachmentPreviewTab['attachment']
  data: string
  encoding: 'base64' | 'utf8'
}

export type UserAttachmentLoadState =
  | { status: 'loading' }
  | { status: 'ready'; value: LoadedUserAttachment }
  | { status: 'error'; message: string }

export function useUserAttachmentPreview(
  tab: UserAttachmentPreviewTab,
): UserAttachmentLoadState & { retry: () => void } {
  const [retryVersion, setRetryVersion] = useState(0)
  const [state, setState] = useState<UserAttachmentLoadState>(() =>
    tab.source.storage === 'draft'
      ? {
          status: 'ready',
          value: {
            attachment: tab.attachment,
            data: tab.source.data,
            encoding: tab.source.encoding,
          },
        }
      : { status: 'loading' },
  )
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation

    if (tab.source.storage === 'draft') {
      setState({
        status: 'ready',
        value: {
          attachment: tab.attachment,
          data: tab.source.data,
          encoding: tab.source.encoding,
        },
      })
      return
    }

    let cancelled = false
    setState({ status: 'loading' })
    void desktopClient.readAttachment(tab.source.attachmentId).then(
      result => {
        if (cancelled || generationRef.current !== generation) return
        if (result.attachment.kind !== 'image' && result.attachment.kind !== 'text') {
          setState({ status: 'error', message: '暂不支持预览此附件。' })
          return
        }
        setState({
          status: 'ready',
          value: {
            attachment: {
              id: result.attachment.id,
              kind: result.attachment.kind,
              name: result.attachment.name,
              mediaType: result.attachment.mediaType,
              sizeBytes: result.attachment.sizeBytes,
            },
            data: result.data,
            encoding: result.encoding,
          },
        })
      },
      () => {
        if (cancelled || generationRef.current !== generation) return
        setState({ status: 'error', message: '附件读取失败，请重试。' })
      },
    )

    return () => {
      cancelled = true
    }
  }, [retryVersion, tab])

  const retry = useCallback(() => {
    setRetryVersion(version => version + 1)
  }, [])

  return { ...state, retry }
}
