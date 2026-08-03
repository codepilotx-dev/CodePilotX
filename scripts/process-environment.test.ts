import { describe, expect, test } from "bun:test"
import { mergeProcessEnvironment } from "./process-environment"

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
})
