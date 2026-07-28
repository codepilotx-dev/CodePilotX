import { describe, expect, test } from "bun:test"
import type { AuthInteraction, Models } from "@earendil-works/pi-ai"
import { PiAuthSessionService } from "../src/auth/PiAuthSessionService"

const waitFor = async (
  service: PiAuthSessionService,
  sessionID: string,
  status: "waiting" | "complete" | "cancelled" | "expired",
) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session = service.status(sessionID)
    if (session.status === status) return session
    await Bun.sleep(2)
  }
  throw new Error(`Auth session did not reach ${status}`)
}

const models = (
  login: (interaction: AuthInteraction) => Promise<void>,
): Models => ({
  getProviders: () => [{
    id: "fixture",
    auth: { oauth: { name: "Fixture OAuth" } },
  }],
  login: async (
    _providerID: string,
    _type: "api_key" | "oauth",
    interaction: AuthInteraction,
  ) => {
    await login(interaction)
    return { type: "oauth", refresh: "refresh", access: "access", expires: 1 }
  },
} as never)

describe("PiAuthSessionService", () => {
  test("承载四类 prompt 和四类安全通知", async () => {
    const answers: string[] = []
    const updates: unknown[] = []
    const fixture = models(async (interaction) => {
      interaction.notify({ type: "info", message: "准备认证" })
      interaction.notify({ type: "auth_url", url: "https://example.test/auth" })
      interaction.notify({
        type: "device_code",
        userCode: "ABCD",
        verificationUri: "https://example.test/device",
      })
      interaction.notify({ type: "progress", message: "等待完成" })
      for (const prompt of [
        { type: "text", message: "账户" },
        { type: "secret", message: "密码" },
        {
          type: "select",
          message: "区域",
          options: [{ id: "cn", label: "中国" }],
        },
        { type: "manual_code", message: "授权码" },
      ] as const) {
        answers.push(await interaction.prompt(prompt))
      }
    })
    const service = new PiAuthSessionService({
      resolveTarget: () => ({ models: fixture, providerID: "fixture" }),
      onUpdated: (session) => {
        updates.push(session)
      },
    })
    let session = await service.start({ kind: "provider", providerId: "fixture" })
    for (const [type, value] of [
      ["text", "account"],
      ["secret", "never-log-this-secret"],
      ["select", "cn"],
      ["manual_code", "code"],
    ] as const) {
      session = await waitFor(service, session.id, "waiting")
      expect(session.prompt?.type).toBe(type)
      session = await service.respond(session.id, session.prompt!.id, value)
    }
    session = await waitFor(service, session.id, "complete")
    expect(answers).toEqual(["account", "never-log-this-secret", "cn", "code"])
    expect(session.notices.map((notice) => notice.type)).toEqual([
      "info",
      "auth_url",
      "device_code",
      "progress",
    ])
    expect(JSON.stringify(updates)).not.toContain("never-log-this-secret")
  })

  test("取消和过期会中止等待中的 Pi prompt", async () => {
    const fixture = models(async (interaction) => {
      await interaction.prompt({ type: "manual_code", message: "授权码" })
    })
    const service = new PiAuthSessionService({
      ttlMs: 20,
      resolveTarget: () => ({ models: fixture, providerID: "fixture" }),
    })
    const cancelled = await service.start({
      kind: "provider",
      providerId: "fixture",
    })
    await waitFor(service, cancelled.id, "waiting")
    expect((await service.cancel(cancelled.id)).status).toBe("cancelled")

    const expired = await service.start({
      kind: "provider",
      providerId: "fixture",
    })
    expect((await waitFor(service, expired.id, "expired")).status).toBe("expired")
  })
})
