import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'
import { AlertTriangle, FileJson, LockKeyhole } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../utils/errors.js'

type CredentialStoreState = RpcResult<'provider/credential/store/read'>
type CredentialStore =
  RpcParams<'provider/credential/store/update'>['store']

type Props = {
  onChanged: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

export function ProviderCredentialStoreSection({
  onChanged,
  onError,
  onNotice,
}: Props): React.ReactNode {
  const [state, setState] = useState<CredentialStoreState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingStore, setPendingStore] = useState<CredentialStore | null>(null)

  useEffect(() => {
    let mounted = true
    void desktopClient.readProviderCredentialStore()
      .then(result => {
        if (mounted) setState(result)
      })
      .catch(error => {
        if (mounted) onError(fullErrorMessage(error))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [onError])

  const targetStore: CredentialStore | null = state
    ? state.store === 'auth-json' ? 'encrypted' : 'auth-json'
    : null

  async function confirmSwitch(): Promise<void> {
    if (!pendingStore || busy) return
    setBusy(true)
    try {
      const result = await desktopClient.updateProviderCredentialStore(
        pendingStore,
      )
      setState(result)
      setPendingStore(null)
      await onChanged()
      onNotice(
        `凭据仓库已切换，已迁移 ${result.migratedCredentials} 个 Provider 凭据。`,
      )
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="model-center-credential-store" aria-label="Provider 凭据存储">
        <div className="model-center-credential-store-icon" aria-hidden>
          {state?.store === 'encrypted' ? <LockKeyhole /> : <FileJson />}
        </div>
        <div className="model-center-credential-store-copy">
          <h2>Provider 凭据存储</h2>
          {loading ? (
            <p>正在读取凭据存储设置…</p>
          ) : state ? (
            <>
              <p>
                当前使用
                <strong>
                  {state.store === 'auth-json' ? ' auth.json' : ' 本机加密仓库'}
                </strong>
                ，保存 {state.credentialCount} 个 Provider API Key/OAuth 凭据。
              </p>
              <p className="model-center-credential-store-warning">
                <AlertTriangle aria-hidden />
                {state.store === 'auth-json'
                  ? 'auth.json 是明文文件，可与 config.json 一起复制到新电脑；请妥善保管，避免上传或分享。'
                  : '加密数据绑定当前系统，无法随备份迁移。换机前请切换到 auth.json，否则需要重新登录。'}
              </p>
              {state.migrationRequired ? (
                <p className="model-center-credential-store-upgrade">
                  检测到升级前保存的加密 Provider 凭据。CodePilotX 会继续使用加密仓库，
                  不会自动导出为明文；如需可迁移备份，请主动切换到 auth.json。
                </p>
              ) : null}
            </>
          ) : (
            <p>暂时无法读取凭据存储设置。</p>
          )}
        </div>
        {targetStore ? (
          <Button
            disabled={busy}
            onClick={() => setPendingStore(targetStore)}
          >
            {targetStore === 'auth-json' ? '改用 auth.json' : '改用加密仓库'}
          </Button>
        ) : null}
      </section>

      <ConfirmationDialog
        actionDisabled={busy}
        actionLabel={busy ? '迁移中…' : '确认迁移并切换'}
        description={
          pendingStore && state
            ? credentialStoreConfirmation(pendingStore, state.credentialCount)
            : ''
        }
        open={pendingStore !== null}
        title={
          pendingStore === 'auth-json'
            ? '切换到 auth.json？'
            : '切换到本机加密仓库？'
        }
        onAction={() => void confirmSwitch()}
        onCancel={() => {
          if (!busy) setPendingStore(null)
        }}
      />
    </>
  )
}

function credentialStoreConfirmation(
  targetStore: CredentialStore,
  credentialCount: number,
): React.ReactNode {
  const scope =
    `将迁移 ${credentialCount} 个 Provider API Key/OAuth 凭据；`
    + 'GitHub、MCP OAuth 与账务凭据不受影响。'
  if (targetStore === 'auth-json') {
    return (
      <>
        {scope}
        <br />
        目标写入并验证成功后，源加密仓库中的 Provider 凭据会被清理。
        auth.json 是可复制的明文文件，请自行保护；CodePilotX 无法删除你另行复制的备份。
      </>
    )
  }
  return (
    <>
      {scope}
      <br />
      目标写入并验证成功后，auth.json 中的 Provider 凭据会被清理，
      但不会删除你另行复制的备份。加密数据绑定当前系统，不能通过备份迁移；
      换机前需切回 auth.json，否则必须重新登录。
    </>
  )
}
