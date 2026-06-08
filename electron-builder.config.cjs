module.exports = {
  appId: 'local.claudecode.desktop',
  productName: 'ClaudeCode Local Desktop',
  files: ['dist/desktop/**/*', 'package.json'],
  directories: {
    output: 'release/desktop',
  },
  win: {
    target: 'nsis',
  },
}
