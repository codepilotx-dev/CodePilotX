import { SandboxManager } from '../sandbox/sandbox-adapter.js'

export async function getSandboxProxyConfig(): Promise<
  { host: string; port: number; protocol: string } | undefined
> {
  if (!SandboxManager.isSandboxingEnabled()) {
    return undefined
  }

  // In REPL mode, SandboxManager.initialize() is fire-and-forget so the proxy
  // may not be ready yet when the first hook fires.
  await SandboxManager.waitForNetworkInitialization()

  const proxyPort = SandboxManager.getProxyPort()
  if (!proxyPort) {
    return undefined
  }

  return { host: '127.0.0.1', port: proxyPort, protocol: 'http' }
}
