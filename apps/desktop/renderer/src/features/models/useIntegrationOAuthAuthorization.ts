import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopClient } from '../../services/desktop-client/index.js'

type Attempt = Awaited<
  ReturnType<typeof desktopClient.authorizeIntegration>
>['attempt']
type AuthorizeRequest =
  Parameters<typeof desktopClient.authorizeIntegration>[0]

type Options = {
  integrationID: AuthorizeRequest['integrationID'] | null
  methodID: AuthorizeRequest['methodID'] | null
  inputs?: Record<string, string>
  onComplete?: () => void | Promise<void>
  onError?: (message: string) => void
}

export function useIntegrationOAuthAuthorization({
  integrationID,
  methodID,
  inputs = {},
  onComplete,
  onError,
}: Options) {
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [submittingCode, setSubmittingCode] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const callbacks = useRef({ onComplete, onError })
  callbacks.current = { onComplete, onError }

  const fail = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setBusy(false)
    setSubmittingCode(false)
    setStatus(null)
    callbacks.current.onError?.(message)
  }, [])

  const start = useCallback(async () => {
    if (!integrationID || !methodID) return
    setBusy(true)
    setSubmittingCode(false)
    setStatus('正在启动授权...')
    try {
      const result = await desktopClient.authorizeIntegration({
        integrationID,
        methodID,
        inputs,
      })
      setAttempt(result.attempt)
      setStatus(result.attempt.instructions || '请在浏览器中完成授权。')
    } catch (error) {
      fail(error)
    }
  }, [fail, inputs, integrationID, methodID])

  const submitCode = useCallback(async () => {
    if (!attempt || !code.trim()) return
    setBusy(true)
    setSubmittingCode(true)
    try {
      await desktopClient.completeIntegrationAuthorization({
        attemptID: attempt.attemptID,
        code: code.trim(),
      })
      setStatus('授权码已提交，正在确认连接状态...')
      setSubmittingCode(false)
    } catch (error) {
      fail(error)
    }
  }, [attempt, code, fail])

  useEffect(() => {
    if (!attempt) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let checks = 0

    const poll = async (): Promise<void> => {
      if (cancelled) return
      if (checks >= 150) {
        setBusy(false)
        setSubmittingCode(false)
        setStatus(null)
        callbacks.current.onError?.('等待授权超时，请重新开始。')
        return
      }
      checks += 1
      try {
        const result = await desktopClient.getIntegrationAuthorizationStatus({
          attemptID: attempt.attemptID,
        })
        if (cancelled) return
        if (result.status.status === 'pending') {
          timer = setTimeout(() => void poll(), 2_000)
          return
        }
        if (result.status.status === 'complete') {
          await callbacks.current.onComplete?.()
          if (cancelled) return
          setAttempt(null)
          setCode('')
          setStatus('授权连接已建立。')
          setBusy(false)
          setSubmittingCode(false)
          return
        }
        const message = result.status.status === 'failed'
          ? result.status.message
          : '授权已过期，请重新开始。'
        setBusy(false)
        setSubmittingCode(false)
        setStatus(null)
        callbacks.current.onError?.(message)
      } catch (error) {
        if (!cancelled) fail(error)
      }
    }

    timer = setTimeout(() => void poll(), 2_000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [attempt, fail])

  const reset = useCallback(() => {
    setAttempt(null)
    setCode('')
    setBusy(false)
    setSubmittingCode(false)
    setStatus(null)
  }, [])

  return {
    attempt,
    busy,
    code,
    reset,
    setCode,
    start,
    status,
    submittingCode,
    submitCode,
  }
}
