module.exports = {
  appId: 'local.claudecode.desktop',
  productName: 'ClaudeCode Local Desktop',
  files: ['dist/desktop/**/*', 'dist/desktop-agent/**/*', 'package.json'],
  asarUnpack: ['dist/desktop-agent/**/*'],
  directories: {
    output: 'release/desktop',
  },
  win: {
    target: 'nsis',
  },
}
