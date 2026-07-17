export type SafeMarkdownTarget =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; href: string }
  | { kind: 'file'; path: string }
  | { kind: 'unsafe' }

const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/
const RELATIVE_PATH = /^(?:\.{1,2}[\\/])/
const UNIX_PATH = /^\//
const BARE_FILE_PATH =
  /^(?![a-zA-Z][a-zA-Z\d+.-]*:)(?:[^<>"|?*\r\n]+[\\/])?[^<>"|?*\r\n]+\.[a-zA-Z\d]{1,12}(?:(?:#L\d+(?:-L?\d+)?)|(?::\d+(?::\d+)?))?$/u

export function classifyMarkdownTarget(target: string): SafeMarkdownTarget {
  const value = target.trim()
  if (!value) return { kind: 'unsafe' }
  if (value.startsWith('#')) return { kind: 'anchor', href: value }
  if (WINDOWS_PATH.test(value) || RELATIVE_PATH.test(value) || UNIX_PATH.test(value)) {
    return { kind: 'file', path: stripFileLocation(value) }
  }
  if (BARE_FILE_PATH.test(value)) {
    return { kind: 'file', path: stripFileLocation(value) }
  }

  try {
    const url = new URL(value)
    if (url.protocol === 'https:') {
      return { kind: 'external', url: url.href }
    }
    if (url.protocol === 'file:') {
      return { kind: 'file', path: stripFileLocation(decodeFileUrl(url)) }
    }
  } catch {
    return { kind: 'unsafe' }
  }
  return { kind: 'unsafe' }
}

export function isSafeHttpsMediaSource(source: string): boolean {
  try {
    return new URL(source).protocol === 'https:'
  } catch {
    return false
  }
}

export function mediaKindForUrl(
  source: string,
): 'audio' | 'image' | 'video' | null {
  if (!isSafeHttpsMediaSource(source)) return null
  const pathname = new URL(source).pathname.toLowerCase()
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/u.test(pathname)) return 'image'
  if (/\.(?:m4a|mp3|oga|ogg|wav)$/u.test(pathname)) return 'audio'
  if (/\.(?:m4v|mp4|ogv|webm)$/u.test(pathname)) return 'video'
  return null
}

export function isLikelyFileReference(value: string): boolean {
  const target = classifyMarkdownTarget(value)
  return target.kind === 'file'
}

function decodeFileUrl(url: URL): string {
  const pathname = decodeURIComponent(url.pathname)
  if (/^\/[a-zA-Z]:\//u.test(pathname)) return pathname.slice(1)
  return pathname
}

function stripFileLocation(path: string): string {
  const hashLocation = /#L\d+(?:-L?\d+)?$/u
  if (hashLocation.test(path)) return path.replace(hashLocation, '')
  return path.replace(/:(\d+)(?::\d+)?$/u, '')
}
