import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Connection, Credential, Integration, Model, Provider } from "../src"

describe("model and provider schemas", () => {
  test("Model.Ref contains providerID, id, and optional variant", () => {
    const decode = Schema.decodeUnknownSync(Model.Ref)
    const encode = Schema.encodeSync(Model.Ref)

    expect(encode(decode({ providerID: "openai", id: "gpt-5" }))).toEqual({
      providerID: "openai",
      id: "gpt-5",
    })
    expect(decode({ providerID: "openai", id: "gpt-5", variant: "high" })).toMatchObject({
      providerID: "openai",
      id: "gpt-5",
      variant: "high",
    })
  })

  test("empty constructors produce complete valid infos", () => {
    const provider = Provider.Info.empty(Provider.ID.openai)
    const model = Model.Info.empty(provider.id, Model.ID.make("gpt-5"))

    expect(Schema.is(Provider.Info)(provider)).toBe(true)
    expect(Schema.is(Model.Info)(model)).toBe(true)
  })
})

describe("integration, credential, and connection schemas", () => {
  test("decodes all integration methods and attempts", () => {
    const info = Schema.decodeUnknownSync(Integration.Info)({
      id: "openai",
      name: "OpenAI",
      methods: [
        {
          id: "oauth-default",
          type: "oauth",
          label: "OAuth",
          prompts: [{ type: "text", key: "tenant", message: "Tenant" }],
        },
        { type: "key", label: "API key" },
        { type: "env", names: ["OPENAI_API_KEY"] },
      ],
      connections: [{ type: "env", name: "OPENAI_API_KEY" }],
    })
    const attempt = Schema.decodeUnknownSync(Integration.Attempt)({
      attemptID: "con_1",
      url: "https://example.com/authorize",
      instructions: "Authorize access",
      mode: "code",
      time: { created: 1, expires: 2 },
    })
    const status = Schema.decodeUnknownSync(Integration.AttemptStatus)({
      status: "failed",
      message: "Denied",
      time: { created: 1, expires: 2 },
    })

    expect(info.methods.map((method) => method.type)).toEqual(["oauth", "key", "env"])
    expect(attempt.mode).toBe("code")
    expect(status.status).toBe("failed")
  })

  test("decodes both credential and connection variants", () => {
    const oauth = Schema.decodeUnknownSync(Credential.Value)({
      type: "oauth",
      methodID: "oauth-default",
      refresh: "refresh-token",
      access: "access-token",
      expires: 0,
      metadata: { account: "primary" },
    })
    const key = Schema.decodeUnknownSync(Credential.Value)({ type: "key", key: "secret" })
    const credentialConnection = Schema.decodeUnknownSync(Connection.Info)({
      type: "credential",
      id: "cred_1",
      label: "Primary",
    })

    expect(oauth.type).toBe("oauth")
    expect(key.type).toBe("key")
    expect(credentialConnection.type).toBe("credential")
  })
})
