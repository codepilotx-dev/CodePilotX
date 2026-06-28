import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { findCodexBinary } from '@codepilotx/codex-app-server-client'

const PACKAGED_TARGET_TRIPLES: Record<NodeJS.Platform, Partial<Record<NodeJS.Architecture, string>>> = {
  win32: {
    x64: 'x86_64-pc-windows-msvc',
    arm64: 'aarch64-pc-windows-msvc',
  },
  darwin: {
    x64: 'x86_64-apple-darwin',
    arm64: 'aarch64-apple-darwin',
  },
  linux: {
    x64: 'x86_64-unknown-linux-musl',
    arm64: 'aarch64-unknown-linux-musl',
  },
}

function resolvePackagedCodexBinary(): string | null {
  const triple = PACKAGED_TARGET_TRIPLES[process.platform]?.[process.arch]
  if (!triple) return null
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const packagedPath = path.join(
    process.resourcesPath,
    'codex',
    'vendor',
    triple,
    'bin',
    binaryName,
  )
  return existsSync(packagedPath) ? packagedPath : null
}

export function resolveCodexBinary(): string {
  if (app.isPackaged) {
    const packaged = resolvePackagedCodexBinary()
    if (packaged) return packaged
  }
  return findCodexBinary().executablePath
}

export function describeCodexBinary(): { source: 'packaged' | 'npm'; path: string } {
  if (app.isPackaged) {
    const packaged = resolvePackagedCodexBinary()
    if (packaged) return { source: 'packaged', path: packaged }
  }
  const resolved = findCodexBinary()
  return { source: 'npm', path: resolved.executablePath }
}