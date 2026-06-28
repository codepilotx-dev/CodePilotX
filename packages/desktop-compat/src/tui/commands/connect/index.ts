import type { Command } from '../../commands.js'
import { getSelectedProviderID } from '../../utils/model/providerConfig.js'

const connect = {
  type: 'local-jsx',
  name: 'connect',
  description: `连接模型提供商（当前为 ${getSelectedProviderID()}）`,
  load: () => import('./connect.js'),
} satisfies Command

export default connect
