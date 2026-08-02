import { RpcMethods } from "./index"
import { TerminalRpcMethods } from "./terminal"
import { LocalEnvironmentHostRpcMethods } from "./local-environment"

export const HostRpcMethods = {
  ...TerminalRpcMethods,
  ...LocalEnvironmentHostRpcMethods,
} as const

/** Server-only runtime method table. Renderer clients must use RpcMethods. */
export const AllRpcMethods = {
  ...RpcMethods,
  ...HostRpcMethods,
} as const
