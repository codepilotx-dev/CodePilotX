export const RUST_SIDECAR_RELEASE_ARGS = [
  'build',
  '--release',
  '--locked',
  '--config',
  'profile.release.strip="symbols"',
  '-p',
  'codepilotx-app-server',
]
