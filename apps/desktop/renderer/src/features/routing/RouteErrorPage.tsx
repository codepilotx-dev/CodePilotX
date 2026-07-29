import type React from 'react'
import { useRouteError } from 'react-router-dom'
import { Button } from '../../components/ui/Button.js'

const DYNAMIC_MODULE_LOAD_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /load failed for module with source/i,
]

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : null
}

export function isDynamicModuleLoadError(error: unknown): boolean {
  const message = errorMessage(error)
  return (
    message !== null &&
    DYNAMIC_MODULE_LOAD_ERROR_PATTERNS.some(pattern => pattern.test(message))
  )
}

type RouteErrorPageContentProps = {
  error: unknown
}

export function RouteErrorPageContent({
  error,
}: RouteErrorPageContentProps): React.ReactNode {
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

export function RouteErrorPage(): React.ReactNode {
  return <RouteErrorPageContent error={useRouteError()} />
}
