import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopAuthTarget } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import { useAuthSession } from '../../provider-management/useAuthSession.js'

export type OAuthConnectionProps = {
  connected: boolean
  description: string
  target: DesktopAuthTarget
  title: string
  onChanged: () => void | Promise<void>
}

export function OAuthConnection({
  connected,
  description,
  target,
  title,
  onChanged,
}: OAuthConnectionProps): React.ReactNode {
  const [error, setError] = useState<string | null>(null)
  const openedUrl = useRef<string | null>(null)
  const auth = useAuthSession({
    target,
    onComplete: onChanged,
    onError: setError,
  })
  const prompt = auth.session?.prompt
  const notices = auth.session?.notices ?? []
  const authUrlNotice = [...notices].reverse().find(
    notice => notice.type === 'auth_url',
  )

  useEffect(() => {
    if (!authUrlNotice || authUrlNotice.url === openedUrl.current) return
    openedUrl.current = authUrlNotice.url
    void desktopClient.openExternalURL(authUrlNotice.url)
  }, [authUrlNotice])

  return (
    <section className="model-center-account-connection">
      <header>
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        <span data-tone={connected ? 'success' : 'neutral'}>
          {connected ? '已授权' : '可授权'}
        </span>
      </header>

      <div className="model-center-account-fields">
        <div className="model-center-account-actions">
          <Button loading={auth.busy} onClick={() => void auth.start()}>
            {connected ? '重新授权' : '开始授权'}
          </Button>
          {auth.session && ['running', 'waiting'].includes(auth.session.status) ? (
            <Button onClick={() => void auth.cancel()}>取消</Button>
          ) : null}
        </div>

        {notices.map((notice, index) => {
          if (notice.type === 'auth_url') {
            return (
              <p key={`${notice.type}-${index}`}>
                {notice.instructions ? `${notice.instructions} ` : null}
                <a
                  href={notice.url}
                  onClick={openExternalLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开授权页面
                </a>
              </p>
            )
          }
          if (notice.type === 'device_code') {
            return (
              <div className="model-center-account-oauth" key={`${notice.type}-${index}`}>
                <p>设备码：<code>{notice.userCode}</code></p>
                <a
                  href={notice.verificationUri}
                  onClick={openExternalLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开设备授权页面
                </a>
              </div>
            )
          }
          return <p key={`${notice.type}-${index}`}>{notice.message}</p>
        })}

        {prompt ? (
          <label className="model-center-account-field">
            <span>{prompt.message}</span>
            {prompt.type === 'select' ? (
              <SettingsDropdown
                ariaLabel={prompt.message}
                onChange={auth.setValue}
                options={(prompt.options ?? []).map(option => ({
                  value: option.id,
                  label: option.label,
                  detail: option.description,
                }))}
                value={auth.value}
                width={340}
              />
            ) : (
              <Input
                aria-label={prompt.message}
                onChange={event => auth.setValue(event.target.value)}
                placeholder={prompt.placeholder}
                type={prompt.type === 'secret' ? 'password' : 'text'}
                value={auth.value}
              />
            )}
            <Button
              disabled={!auth.value.trim()}
              loading={auth.busy}
              onClick={() => void auth.respond()}
            >
              {prompt.type === 'manual_code' ? '提交授权码' : '继续'}
            </Button>
          </label>
        ) : null}
      </div>
      {error ? <p className="model-center-account-error" role="status">{error}</p> : null}
    </section>
  )
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void desktopClient.openExternalURL(event.currentTarget.href)
}
