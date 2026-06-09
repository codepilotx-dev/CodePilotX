import type { Command } from '../../commands.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: '显示 Oh-My-AgentCode 使用统计和活动',
  load: () => import('./stats.js'),
} satisfies Command

export default stats
