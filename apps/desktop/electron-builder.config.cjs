module.exports = {
  appId: 'local.codepilotx.desktop',
  productName: 'CodePilotX Local Desktop',
  files: ['dist/desktop/**/*', 'dist/desktop-agent/**/*', 'package.json'],
  extraResources: [{ from: 'apps/desktop/build/icon.ico', to: 'icon.ico' }],
  asarUnpack: ['dist/desktop-agent/**/*'],
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
