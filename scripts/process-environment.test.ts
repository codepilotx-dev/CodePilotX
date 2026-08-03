import { describe, expect, test } from "bun:test"
import {
  createIsolatedProcessEnvironment,
  mergeProcessEnvironment,
} from "./process-environment"

describe("发布进程环境", () => {
  test("Windows 风格的大小写异名覆盖不会保留 runner 注入值", () => {
    expect(mergeProcessEnvironment(
      {
        codepilotx_agent_url: "http://runner.invalid",
        Path: "runner-path",
        KEEP: "yes",
      },
      {
        CODEPILOTX_AGENT_URL: undefined,
        PATH: "release-path",
      },
    )).toEqual({
      CODEPILOTX_AGENT_URL: undefined,
      PATH: "release-path",
      KEEP: "yes",
    })
  })

  test("发布 smoke 仅保留显式注入的内部环境", () => {
    expect(createIsolatedProcessEnvironment(
      {
        codepilotx_agent_url: "http://runner.invalid",
        CodePilotX_Static_Dir: "runner-static",
        GITHUB_EVENT_PATH: "event.json",
        Runner_Temp: "runner-temp",
        ACTIONS_CACHE_URL: "https://cache.invalid",
        RELEASE_BOT_TOKEN: "release-token",
        CSC_KEY_PASSWORD: "signing-password",
        KEEP: "yes",
      },
      {
        CODEPILOTX_AUTH_TOKEN: "smoke-token",
        CODEPILOTX_DATA_DIR: "smoke-data",
      },
    )).toEqual({
      KEEP: "yes",
      CODEPILOTX_AUTH_TOKEN: "smoke-token",
      CODEPILOTX_DATA_DIR: "smoke-data",
    })
  })
})
