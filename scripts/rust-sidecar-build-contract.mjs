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
