import type { Effect } from "effect"

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface HookContract<Input = unknown, Output = unknown> {
  readonly input: Input
  readonly output: Output
}

export type HookSpec = Record<string, HookContract>

export type HookCallback<Contract extends HookContract> = (
  input: Contract["input"],
  output: Contract["output"],
) => Effect.Effect<void, unknown> | void

export interface PluginHooks<Spec extends HookSpec> {
  readonly on: <Name extends keyof Spec & string>(
    name: Name,
    callback: HookCallback<Spec[Name]>,
  ) => Effect.Effect<Registration>
}
