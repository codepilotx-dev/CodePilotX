module.exports = {
  appId: 'local.codepilotx.desktop',
  productName: 'CodePilotX Local Desktop',
  files: ['dist/desktop/**/*', 'dist/desktop-agent/**/*', 'package.json'],
  asarUnpack: ['dist/desktop-agent/**/*'],
  directories: {
    output: 'release/desktop',
  },
  win: {
    target: 'nsis',
  },
}
