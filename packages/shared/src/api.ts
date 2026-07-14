import { Connection, Credential, Integration, Model, Provider } from "@codepilotx/model-schema"
import { Schema } from "effect"
import { CatalogProviderSchema } from "./model"

export const ProviderTestRequestSchema = Schema.Struct({
  providerID: Provider.ID,
})
export type ProviderTestRequest = typeof ProviderTestRequestSchema.Type

export const ProviderTestResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
})
export type ProviderTestResponse = typeof ProviderTestResponseSchema.Type

export const UpdateProviderSettingsRequestSchema = CatalogProviderSchema
export type UpdateProviderSettingsRequest = typeof UpdateProviderSettingsRequestSchema.Type

export const ProvidersResponseSchema = Schema.Struct({
  providers: Schema.Array(CatalogProviderSchema),
  defaultModel: Schema.NullOr(Model.Ref),
  reviewerModel: Schema.NullOr(Model.Ref),
})
export type ProvidersResponse = typeof ProvidersResponseSchema.Type

export const IntegrationListResponseSchema = Schema.Struct({
  integrations: Schema.Array(Integration.Info),
})
export type IntegrationListResponse = typeof IntegrationListResponseSchema.Type

export const IntegrationConnectRequestSchema = Schema.Struct({
  integrationID: Integration.ID,
  key: Schema.String,
  label: Schema.optional(Schema.String),
})
export type IntegrationConnectRequest = typeof IntegrationConnectRequestSchema.Type

export const IntegrationAuthorizeRequestSchema = Schema.Struct({
  integrationID: Integration.ID,
  methodID: Integration.MethodID,
  inputs: Integration.Inputs,
  label: Schema.optional(Schema.String),
})
export type IntegrationAuthorizeRequest = typeof IntegrationAuthorizeRequestSchema.Type

export const IntegrationAuthorizeResponseSchema = Schema.Struct({
  attempt: Integration.Attempt,
})
export type IntegrationAuthorizeResponse = typeof IntegrationAuthorizeResponseSchema.Type

export const IntegrationAuthorizeCompleteRequestSchema = Schema.Struct({
  attemptID: Integration.AttemptID,
  code: Schema.optional(Schema.String),
})
export type IntegrationAuthorizeCompleteRequest = typeof IntegrationAuthorizeCompleteRequestSchema.Type

export const IntegrationAuthorizeStatusRequestSchema = Schema.Struct({
  attemptID: Integration.AttemptID,
})
export type IntegrationAuthorizeStatusRequest = typeof IntegrationAuthorizeStatusRequestSchema.Type

export const IntegrationAuthorizeStatusResponseSchema = Schema.Struct({
  status: Integration.AttemptStatus,
})
export type IntegrationAuthorizeStatusResponse = typeof IntegrationAuthorizeStatusResponseSchema.Type

export const IntegrationDisconnectRequestSchema = Schema.Struct({
  integrationID: Integration.ID,
  credentialID: Credential.ID,
})
export type IntegrationDisconnectRequest = typeof IntegrationDisconnectRequestSchema.Type

export const OkResponseSchema = Schema.Struct({ ok: Schema.Literal(true) })
export type OkResponse = typeof OkResponseSchema.Type

export const CatalogUpdatedNotificationSchema = ProvidersResponseSchema
export type CatalogUpdatedNotification = typeof CatalogUpdatedNotificationSchema.Type

export const IntegrationUpdatedNotificationSchema = Schema.Struct({
  integration: Integration.Info,
})
export type IntegrationUpdatedNotification = typeof IntegrationUpdatedNotificationSchema.Type

export const IntegrationAuthorizationCompletedNotificationSchema = Schema.Struct({
  attemptID: Integration.AttemptID,
  integrationID: Integration.ID,
  connection: Connection.Info,
})
export type IntegrationAuthorizationCompletedNotification =
  typeof IntegrationAuthorizationCompletedNotificationSchema.Type

export const IntegrationAuthorizationFailedNotificationSchema = Schema.Struct({
  attemptID: Integration.AttemptID,
  integrationID: Integration.ID,
  message: Schema.String,
})
export type IntegrationAuthorizationFailedNotification =
  typeof IntegrationAuthorizationFailedNotificationSchema.Type

export const ApiErrorSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
    details: Schema.optional(Schema.Unknown),
  }),
})
export type ApiError = typeof ApiErrorSchema.Type
