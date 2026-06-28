import type { Command } from '../../commands.js'

const hooks = {
  type: 'local-jsx',
  name: 'hooks',
  description: '查看工具事件的 hook 配置',
  immediate: true,
  load: () => import('./hooks.js'),
} satisfies Command

export default hooks
