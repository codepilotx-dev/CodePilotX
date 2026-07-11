/**
 * Build the Rust app-server binary and copy it to dist/desktop-rust-sidecar/.
 *
 * Usage:
 *   node scripts/prepare-desktop-rust-sidecar.mjs --release
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUST_SIDECAR_RELEASE_ARGS } from './rust-sidecar-build-contract.mjs'
import { parseCargoSourceConfigArgs } from './rust-sidecar-build-contract.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

if (!process.argv.includes('--release')) {
  console.error('[rust-sidecar] Release packaging requires --release.')
  process.exit(1)
}
const profile = 'release'
const targetDir = join(root, 'rust', 'codex-rs', 'target', profile)
const binaryName = process.platform === 'win32'
  ? 'codepilotx-app-server.exe'
  : 'codepilotx-app-server'
const binaryPath = join(targetDir, binaryName)
const cargoSourceConfigArgs = parseCargoSourceConfigArgs(process.argv.slice(2))

// 1. Build the Rust crate
console.log(`[rust-sidecar] Building codepilotx-app-server (${profile})...`)
try {
  execFileSync('cargo', [...RUST_SIDECAR_RELEASE_ARGS, ...cargoSourceConfigArgs], {
    cwd: join(root, 'rust', 'codex-rs'),
    stdio: 'inherit',
  })
} catch (err) {
  console.error(
    '[rust-sidecar] Failed to build codepilotx-app-server. Is cargo installed?',
  )
  console.error(
    '[rust-sidecar] Ensure you have the Rust toolchain installed: https://rustup.rs',
  )
  process.exit(1)
}

// 2. Verify binary exists
if (!existsSync(binaryPath)) {
  console.error(
    `[rust-sidecar] Build succeeded but binary not found at: ${binaryPath}`,
  )
  process.exit(1)
}

// 3. Copy to dist/desktop-rust-sidecar/
const distDir = join(root, 'dist', 'desktop-rust-sidecar')
mkdirSync(distDir, { recursive: true })
const destPath = join(distDir, binaryName)
copyFileSync(binaryPath, destPath)
console.log(`[rust-sidecar] Copied ${binaryName} to ${destPath}`)
console.log('[rust-sidecar] Done.')
