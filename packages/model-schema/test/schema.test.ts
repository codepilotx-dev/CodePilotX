import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Credential, Model, Provider } from "../src"

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

describe("credential schemas", () => {
  test("decodes OAuth and API key variants", () => {
    const oauth = Schema.decodeUnknownSync(Credential.Value)({
      type: "oauth",
      methodID: "oauth-default",
      refresh: "refresh-token",
      access: "access-token",
      expires: 0,
      metadata: { account: "primary" },
    })
    const key = Schema.decodeUnknownSync(Credential.Value)({ type: "key", key: "secret" })
    expect(oauth.type).toBe("oauth")
    expect(key.type).toBe("key")
  })
})
