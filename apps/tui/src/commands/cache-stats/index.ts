import type { Command } from '../../commands.js'

const cacheStats = {
  type: 'local-jsx',
  name: 'cache-stats',
  description: '显示当前会话的 prompt cache 命中率与节省',
  load: () => import('./cacheStats.js'),
} satisfies Command

export default cacheStats
