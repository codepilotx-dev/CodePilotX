import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function isTrustedRendererUrl(
  senderUrl: string | undefined,
  trustedRendererUrl: string,
): boolean {
  if (!senderUrl) return false
  if (senderUrl === trustedRendererUrl) return true

  try {
    const parsedSender = new URL(senderUrl)
    const parsedTrusted = new URL(trustedRendererUrl)
    if (parsedSender.protocol !== parsedTrusted.protocol) return false

    if (parsedSender.protocol === 'file:') {
      return isTrustedFileUrl(parsedSender, parsedTrusted)
    }

    if (parsedSender.origin !== parsedTrusted.origin) return false
    return isSameOrInsideUrlPath(parsedSender.pathname, parsedTrusted.pathname)
  } catch {
    return false
  }
}

function isTrustedFileUrl(sender: URL, trusted: URL): boolean {
  if (!isLocalFileUrl(sender) || !isLocalFileUrl(trusted)) return false
  const trustedPath = canonicalPath(fileURLToPath(trusted))
  const senderPath = canonicalPath(fileURLToPath(sender))
  return isSameOrInsidePath(senderPath, trustedPath)
}

function isLocalFileUrl(url: URL): boolean {
  return url.host === '' || url.host === 'localhost'
}

function isSameOrInsideUrlPath(senderPath: string, trustedPath: string): boolean {
  if (senderPath === trustedPath) return true
  const trustedDirectory = trustedPath.endsWith('/')
    ? trustedPath
    : trustedPath.replace(/[^/]+$/, '')
  return senderPath.startsWith(trustedDirectory)
}

function isSameOrInsidePath(candidatePath: string, trustedFilePath: string): boolean {
  if (candidatePath === trustedFilePath) return true
  const rel = relative(dirname(trustedFilePath), candidatePath)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

function canonicalPath(path: string): string {
  const normalized = realpathSync.native(resolve(path))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
