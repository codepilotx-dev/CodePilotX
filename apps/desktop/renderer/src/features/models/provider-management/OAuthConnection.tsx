import type React from 'react'
import { useMemo, useState } from 'react'
import type {
  DesktopIntegration,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { providerManagementStore } from '../../provider-management/index.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import { useIntegrationOAuthAuthorization } from '../useIntegrationOAuthAuthorization.js'

type OAuthMethod = Extract<
  DesktopIntegration['methods'][number],
  { type: 'oauth' }
>

export type OAuthConnectionProps = {
  connected: boolean
  description: string
  integration: DesktopIntegration
  title: string
  onChanged: () => void | Promise<void>
}

export function OAuthConnection({
  connected,
  description,
  integration,
  title,
  onChanged,
}: OAuthConnectionProps): React.ReactNode {
  const method = useMemo(
    () => integration.methods.find(
      (candidate): candidate is OAuthMethod => candidate.type === 'oauth',
    ),
    [integration.methods],
  )
  const credentials = integration.connections.filter(
    connection => connection.type === 'credential',
  )
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const oauth = useIntegrationOAuthAuthorization({
    integrationID: integration.id,
    methodID: method?.id ?? null,
    inputs,
    onComplete: onChanged,
    onError: setError,
  })

  async function disconnect(): Promise<void> {
    if (credentials.length === 0) return
    setDisconnecting(true)
    setError(null)
    try {
      await Promise.all(credentials.map(connection =>
        providerManagementStore.disconnectIntegration({
          integrationID: integration.id,
          credentialID: connection.id,
        }),
      ))
      oauth.reset()
      await onChanged()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError))
    } finally {
      setDisconnecting(false)
    }
  }

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
      {method ? (
        <div className="model-center-account-fields">
          {method.prompts?.filter(prompt => {
            if (!prompt.when) return true
            const matches = inputs[prompt.when.key] === prompt.when.value
            return prompt.when.op === 'eq' ? matches : !matches
          }).map(prompt => (
            <label className="model-center-account-field" key={prompt.key}>
              <span>{prompt.message}</span>
              {prompt.type === 'select' ? (
                <SettingsDropdown
                  ariaLabel={prompt.message}
                  onChange={value => setInputs(current => ({
                    ...current,
                    [prompt.key]: value,
                  }))}
                  options={prompt.options.map(option => ({
                    value: option.value,
                    label: option.label,
                    detail: option.hint,
                  }))}
                  value={inputs[prompt.key] ?? ''}
                  width={340}
                />
              ) : (
                <Input
                  onChange={event => setInputs(current => ({
                    ...current,
                    [prompt.key]: event.target.value,
                  }))}
                  placeholder={prompt.placeholder}
                  value={inputs[prompt.key] ?? ''}
                />
              )}
            </label>
          ))}
          <div className="model-center-account-actions">
            <Button loading={oauth.busy} onClick={() => void oauth.start()}>
              {connected ? '重新授权' : '浏览器授权'}
            </Button>
            {connected ? (
              <Button
                loading={disconnecting}
                onClick={() => void disconnect()}
                tone="danger"
              >
                断开
              </Button>
            ) : null}
          </div>
          {oauth.attempt ? (
            <div className="model-center-account-oauth">
              <p>{oauth.attempt.instructions || oauth.status}</p>
              {oauth.attempt.url ? (
                <a
                  href={oauth.attempt.url}
                  onClick={openExternalLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开授权页面
                </a>
              ) : null}
              {oauth.attempt.mode === 'code' ? (
                <div className="model-center-account-actions">
                  <Input
                    aria-label={`${title} 授权返回码`}
                    onChange={event => oauth.setCode(event.target.value)}
                    placeholder="输入授权返回码"
                    value={oauth.code}
                  />
                  <Button
                    disabled={!oauth.code.trim()}
                    loading={oauth.submittingCode}
                    onClick={() => void oauth.submitCode()}
                  >
                    提交
                  </Button>
                </div>
              ) : null}
            </div>
          ) : oauth.status ? <p>{oauth.status}</p> : null}
        </div>
      ) : <p>此连接当前没有可用的 OAuth 授权方式。</p>}
      {error ? <p className="model-center-account-error" role="status">{error}</p> : null}
    </section>
  )
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void desktopClient.openExternalURL(event.currentTarget.href)
}
