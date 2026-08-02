import { describe, expect, test } from "bun:test"
import type { AgentConfig } from "../src/config/Config"
import type { ConfigEdit, ConfigService } from "../src/config/ConfigService"
import type { AgentLogger } from "../src/observability/AgentLogger"
import { createApp, type TransportDependencies } from "../src/transport/server"

const createSettingsApp = () => {
  const runtimeSettings = new Map<string, unknown>()
  let writtenEdits: ConfigEdit[] = []
  const configService = {
    read: async () => ({
      config: {
        model: "profile-model",
        desktop: {
          sidebarOrganization: "flat",
          sidebarProjectSort: "updated",
          sidebarSort: "manual",
        },
      },
      origins: {},
      diagnostics: [],
      layers: [],
      profileState: {
        activeProfile: null,
        selectedProfile: null,
        restartRequired: false,
      },
    }),
    batchWrite: async ({ edits }: { edits: ConfigEdit[] }) => {
      writtenEdits = edits
      return { status: "ok", version: "v1", filePath: "config.json" }
    },
  } as unknown as ConfigService
  const db = {
    getSetting: (key: string) => runtimeSettings.get(key) ?? null,
    setSetting: (key: string, value: unknown) => {
      runtimeSettings.set(key, value)
    },
  }
  const app = createApp({
    config: {} as AgentConfig,
    configService,
    db,
    logger: {
      request: () => undefined,
      error: () => undefined,
      warn: () => undefined,
    } as unknown as AgentLogger,
    hub: {},
    threads: {},
    history: {},
    approvals: {},
    questions: {},
    subagents: {},
    attachments: {},
    projectSources: {},
    providers: {},
    integrations: {},
    apiKeys: {},
    memory: {},
    hooks: {},
    review: {},
    github: {},
    tooling: {},
    pets: {},
    skills: {},
    mcp: {},
    suggestions: {},
    usage: {},
  } as unknown as TransportDependencies)
  return {
    app,
    runtimeSettings,
    writtenEdits: () => writtenEdits,
  }
}

describe("桌面侧栏运行时设置", () => {
  test("手动顺序只写 runtime-state，并与 config.json 投影合并读取", async () => {
    const { app, runtimeSettings, writtenEdits } = createSettingsApp()
    const response = await app.request("/api/config/desktop-projection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "profile-model",
        sidebarOrganization: "flat",
        sidebarProjectSort: "updated",
        sidebarSort: "manual",
        sidebarManualOrder: { all: ["session-1"] },
      }),
    })

    expect(response.status).toBe(200)
    expect(runtimeSettings.get("desktop.runtime-state.v1")).toEqual({
      sidebarManualOrder: { all: ["session-1"] },
    })
    expect(writtenEdits()).toEqual([])

    const readResponse = await app.request("/api/config/desktop-projection")
    expect(readResponse.status).toBe(200)
    expect(await readResponse.json()).toMatchObject({
      sidebarOrganization: "flat",
      sidebarProjectSort: "updated",
      sidebarSort: "manual",
      sidebarManualOrder: { all: ["session-1"] },
    })
  })

  test("终端 profile 使用独立 machine-local key，旧客户端省略字段时保留", async () => {
    const { app, runtimeSettings, writtenEdits } = createSettingsApp()
    const terminalResponse = await app.request("/api/config/desktop-projection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalProfileId: "powershell" }),
    })
    expect(terminalResponse.status).toBe(200)
    expect(runtimeSettings.get("desktop.terminal-settings.v1")).toEqual({
      terminalProfileId: "powershell",
    })
    expect(runtimeSettings.get("desktop.runtime-state.v1")).toEqual({})
    expect(writtenEdits()).toEqual([])

    await app.request("/api/config/desktop-projection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sidebarSort: "manual" }),
    })
    expect(runtimeSettings.get("desktop.terminal-settings.v1")).toEqual({
      terminalProfileId: "powershell",
    })
    expect(await (await app.request("/api/config/desktop-projection")).json()).toMatchObject({
      terminalProfileId: "powershell",
    })
  })
})
