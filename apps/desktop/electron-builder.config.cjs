module.exports = {
  appId: 'local.codepilotx.desktop',
	  productName: 'CodePilotX',
  files: [
    'dist/desktop/**/*',
    'dist/desktop-agent/**/*',
    'dist/desktop-runtime/**/*',
    'package.json',
  ],
  extraResources: [
    { from: 'apps/desktop/build/icon.ico', to: 'icon.ico' },
    { from: 'dist/desktop-rust-sidecar', to: 'desktop-rust-sidecar' },
  ],
  asarUnpack: [
    'dist/desktop-agent/**/*',
    'dist/desktop-runtime/**/*',
  ],
  directories: {
    output: 'release/desktop',
  },
  win: {
    icon: 'apps/desktop/build/icon.ico',
    target: 'nsis',
  },
  nsis: {
    installerIcon: 'apps/desktop/build/icon.ico',
    uninstallerIcon: 'apps/desktop/build/icon.ico',
  },
}
