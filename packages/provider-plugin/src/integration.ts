import type { Connection, Credential, Integration } from "@codepilotx/model-schema"
import type { Effect } from "effect"
import type { Registration } from "./registration"

export type OAuthAuthorization = {
  readonly url: string
  readonly instructions: string
} & (
  | {
      readonly mode: "auto"
      readonly callback: Effect.Effect<Credential.Value, unknown>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Effect.Effect<Credential.Value, unknown>
    }
)

export interface OAuthAuthRegistration {
  readonly integrationID: Integration.ID
  readonly method: Integration.OAuthMethod
  readonly authorize: (
    inputs: Integration.Inputs,
  ) => Effect.Effect<OAuthAuthorization, unknown>
  readonly refresh?: (credential: Credential.OAuth) => Effect.Effect<Credential.OAuth, unknown>
  readonly label?: (credential: Credential.OAuth) => string | undefined
}

export type AuthRegistration =
  | OAuthAuthRegistration
  | {
      readonly integrationID: Integration.ID
      readonly method: Integration.KeyMethod | Integration.EnvMethod
    }

export interface IntegrationHooks {
  readonly register: (integration: Integration.Info) => Effect.Effect<Registration>
  readonly list: () => Effect.Effect<readonly Integration.Info[]>
}

export interface AuthHooks {
  readonly register: (auth: AuthRegistration) => Effect.Effect<Registration>
  readonly list: (integrationID?: Integration.ID) => Effect.Effect<readonly AuthRegistration[]>
  readonly connection: {
    readonly active: (integrationID: Integration.ID) => Effect.Effect<Connection.Info | undefined>
    readonly resolve: (connection: Connection.Info) => Effect.Effect<Credential.Value | undefined, unknown>
  }
}

export interface AuthConnectionResolver {
  readonly active: (integrationID: Integration.ID) => Effect.Effect<Connection.Info | undefined>
  readonly resolve: (connection: Connection.Info) => Effect.Effect<Credential.Value | undefined, unknown>
}
