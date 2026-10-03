import { ComputerHostRpcMethods } from './computer'
import { BrowserHostRpcMethods } from './browser'
import { RpcMethods } from './index'
import { TerminalRpcMethods } from './terminal'
import { LocalEnvironmentHostRpcMethods } from './local-environment'

export const HostRpcMethods = {
  ...ComputerHostRpcMethods,
  ...BrowserHostRpcMethods,
  ...TerminalRpcMethods,
  ...LocalEnvironmentHostRpcMethods,
} as const

/** Server-only runtime method table. Renderer clients must use RpcMethods. */
export const AllRpcMethods = {
  ...RpcMethods,
  ...HostRpcMethods,
} as const
