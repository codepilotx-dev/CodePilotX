import type { Command } from '../../commands.js'
import { getSelectedProviderID } from '../../utils/model/providerConfig.js'

const connect = {
  type: 'local-jsx',
  name: 'connect',
  description: `Connect a model provider (current: ${getSelectedProviderID()})`,
  load: () => import('./connect.js'),
} satisfies Command

export default connect
