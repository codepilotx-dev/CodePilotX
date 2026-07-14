import { describe, expect, test } from "bun:test"
import type { SessionPart } from "../src/domain"
import { Projection } from "../src/transport/Projection"
import type { AgentDatabase } from "../src/storage/Database"

describe("活动投影", () => {
  test("透传只读工具命令和输出", () => {
    const projection = new Projection({} as unknown as AgentDatabase)
    const part: SessionPart = {
      id: "activity-1",
      runID: "run-1",
      type: "activity",
      status: "completed",
      data: {
        role: "planner",
        activity: "notice",
        title: "读取文件",
        detail: "README.md",
        commands: [{
          command: "workspace_read README.md",
          output: "# README",
          status: "success",
          truncated: false,
        }],
      },
      createdAt: 1000,
      updatedAt: 1001,
    }

    expect(projection.part(part)).toMatchObject({
      type: "activity",
      title: "读取文件",
      detail: "README.md",
      commands: [{
        command: "workspace_read README.md",
        output: "# README",
        status: "success",
        truncated: false,
      }],
    })
  })
})
