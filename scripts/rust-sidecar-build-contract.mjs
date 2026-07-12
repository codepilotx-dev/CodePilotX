export const RUST_SIDECAR_RELEASE_ARGS = [
  'build',
  '--release',
  '--locked',
  '--config',
  'profile.release.strip="symbols"',
  '--config',
  'profile.release.lto=false',
  '-p',
  'codepilotx-app-server',
]

export const RUST_SIDECAR_DEBUG_ARGS = [
  'build',
  '--locked',
  '-p',
  'codepilotx-app-server',
]

export function resolveRustSidecarBuild(argv) {
  return argv.includes('--release')
    ? { profile: 'release', args: RUST_SIDECAR_RELEASE_ARGS }
    : { profile: 'debug', args: RUST_SIDECAR_DEBUG_ARGS }
}

export function parseCargoSourceConfigArgs(argv) {
  const args = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--cargo-config') continue
    const value = argv[index + 1]
    if (!value || !value.startsWith('source.') || /[\r\n]/.test(value)) {
      throw new Error('--cargo-config only accepts a single Cargo source.* configuration')
    }
    args.push('--config', value)
    index += 1
  }
  return args
}
