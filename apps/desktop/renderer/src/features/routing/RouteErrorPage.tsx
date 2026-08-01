import { useEffect, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { Button } from '../../components/ui/Button.js'

const DYNAMIC_MODULE_RELOAD_KEY =
  'codepilotx.route.dynamic-module-reload'
const DYNAMIC_MODULE_RELOAD_COOLDOWN_MS = 30_000

const DYNAMIC_MODULE_LOAD_ERROR_PATTERN =
  /(?:failed to fetch|error loading) dynamically imported module|importing a module script failed|load failed for module with source/i

export function isDynamicModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : ''
  return DYNAMIC_MODULE_LOAD_ERROR_PATTERN.test(message)
}

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>

export function claimDynamicModuleReload(
  error: unknown,
  storage: ReloadStorage | undefined,
  now = Date.now(),
): boolean {
  if (!isDynamicModuleLoadError(error) || !storage) return false

  try {
    const lastReloadAt = Number(storage.getItem(DYNAMIC_MODULE_RELOAD_KEY))
    if (
      lastReloadAt
      && now - lastReloadAt < DYNAMIC_MODULE_RELOAD_COOLDOWN_MS
    ) {
      return false
    }

    storage.setItem(DYNAMIC_MODULE_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

type RouteErrorPageContentProps = {
  error: unknown
}

export function RouteErrorPageContent({
  error,
}: RouteErrorPageContentProps): ReactNode {
  const isDynamicModuleError = isDynamicModuleLoadError(error)

  return (
    <main className="not-found-page" role="alert">
      <span aria-hidden="true">!</span>
      <h1>
        {isDynamicModuleError
          ? '界面模块未加载完成'
          : '页面暂时无法显示'}
      </h1>
      <p>
        {isDynamicModuleError
          ? '应用可能正在更新，请重新加载后继续。'
          : '应用遇到临时问题，请重新加载后继续。'}
      </p>
      <Button onClick={() => window.location.reload()}>重新加载</Button>
    </main>
  )
}

export function RouteErrorPage(): ReactNode {
  const error = useRouteError()

  useEffect(() => {
    try {
      if (claimDynamicModuleReload(error, window.sessionStorage)) {
        queueMicrotask(() => window.location.reload())
      }
    } catch {
      // Accessing sessionStorage itself can fail under restricted policies.
    }
  }, [error])

  return <RouteErrorPageContent error={error} />
}
